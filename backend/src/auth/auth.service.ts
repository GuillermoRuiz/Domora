import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'node:crypto';
import type { StringValue } from 'ms';
import type { AdminStatus } from '../prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { SupportSessionsService } from '../support-access/support-sessions.service';
import { resolveFrontendBaseUrl } from '../common/frontend-url';
import type { RegisterDto } from './dto/register.dto';
import type { RedeemAdminInviteDto } from './dto/redeem-admin-invite.dto';
import type { RedeemTeamInviteDto } from './dto/redeem-team-invite.dto';
import type { AppRole, AuthenticatedUser, JwtPayload } from './auth.types';

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, per doc/plan.md 2.3
const PASSWORD_HASH_ROUNDS = 10; // mismo coste que backend/prisma/seed.ts
const ADMIN_INVITE_TTL = '7d';
const ADMIN_INVITE_TYPE = 'admin_invite';
const TEAM_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 días, mismo criterio que admin-invites
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000; // 1h — ventana de seguridad, no de conveniencia

interface AdminInvitePayload {
  type: typeof ADMIN_INVITE_TYPE;
  administratorId: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface LoginResult extends AuthTokens {
  user: {
    id: string;
    fullName: string;
    role: AppRole;
    estateIds: string[];
    administratorId: string | null;
    /** Solo poblado para rol B — el frontend lo usa para avisar antes de que el gate de acceso corte algo. */
    subscriptionStatus?: AdminStatus;
  };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly mail: MailService,
    private readonly supportSessions: SupportSessionsService,
  ) {}

  async login(email: string, password: string): Promise<LoginResult> {
    const user = await this.prisma.user.findFirst({
      where: { email, deletedAt: null },
    });
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const estateIds = await this.resolveEstateIds(
      user.id,
      user.role,
      user.administratorId,
    );
    const tokens = await this.issueTokens({
      id: user.id,
      role: user.role,
      estateIds,
      administratorId: user.administratorId,
    });
    const subscriptionStatus = await this.resolveSubscriptionStatus(
      user.role,
      user.administratorId,
    );

    return {
      ...tokens,
      user: {
        id: user.id,
        fullName: user.fullName,
        role: user.role,
        estateIds,
        administratorId: user.administratorId,
        subscriptionStatus,
      },
    };
  }

  /**
   * Estado de suscripción de la gestora, solo relevante para rol B —
   * SubscriptionStatusGuard es quien de verdad corta el acceso; esto es
   * solo para que el frontend pueda avisar antes de que algo falle.
   */
  private async resolveSubscriptionStatus(
    role: AppRole,
    administratorId: string | null,
  ): Promise<AdminStatus | undefined> {
    if (role !== 'B' || !administratorId) return undefined;
    const admin = await this.prisma.administrator.findUnique({
      where: { id: administratorId },
      select: { status: true },
    });
    return admin?.status;
  }

  /** Auto-registro abierto — solo rol C (propietario). Deja la sesión iniciada, mismo shape que login(). */
  async register(dto: RegisterDto): Promise<LoginResult> {
    const existing = await this.prisma.user.findFirst({
      where: { email: dto.email, deletedAt: null },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('Ya existe una cuenta con ese email.');
    }

    const passwordHash = await bcrypt.hash(dto.password, PASSWORD_HASH_ROUNDS);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        fullName: dto.fullName,
        role: 'C',
        termsAcceptedAt: new Date(),
      },
    });

    const tokens = await this.issueTokens({
      id: user.id,
      role: user.role,
      estateIds: [], // usuario recién creado — todavía sin ninguna propiedad vinculada
      administratorId: null,
    });

    return {
      ...tokens,
      user: {
        id: user.id,
        fullName: user.fullName,
        role: user.role,
        estateIds: [],
        administratorId: null,
      },
    };
  }

  /**
   * Invitación controlada de administradores (rol A crea la empresa, un
   * humano todavía tiene que reclamarla con una contraseña real). Sin
   * mailer en el proyecto — el token/enlace se genera para compartir a
   * mano, no se envía ningún email. `primaryUserId === null` es el único
   * guardián de un solo uso: el token en sí es reutilizable hasta que se
   * canjea con éxito.
   */
  async createAdminInvite(administratorId: string): Promise<{ token: string }> {
    const administrator = await this.prisma.administrator.findUnique({
      where: { id: administratorId },
      select: { primaryUserId: true },
    });
    if (!administrator) {
      throw new NotFoundException(
        `Administradora ${administratorId} no encontrada.`,
      );
    }
    if (administrator.primaryUserId) {
      throw new ConflictException(
        'Esta administradora ya tiene un usuario asociado.',
      );
    }

    const payload: AdminInvitePayload = {
      type: ADMIN_INVITE_TYPE,
      administratorId,
    };
    const token = await this.jwtService.signAsync(payload, {
      expiresIn: ADMIN_INVITE_TTL,
    });
    return { token };
  }

  private async verifyAdminInvite(
    token: string,
  ): Promise<{ administratorId: string; administratorName: string }> {
    let payload: AdminInvitePayload;
    try {
      payload = await this.jwtService.verifyAsync<AdminInvitePayload>(token);
    } catch {
      throw new UnauthorizedException(
        'El enlace de invitación no es válido o caducó.',
      );
    }
    if (payload.type !== ADMIN_INVITE_TYPE) {
      throw new UnauthorizedException('El enlace de invitación no es válido.');
    }
    const administrator = await this.prisma.administrator.findUnique({
      where: { id: payload.administratorId },
      select: { name: true, primaryUserId: true },
    });
    if (!administrator) {
      throw new NotFoundException('Administradora no encontrada.');
    }
    if (administrator.primaryUserId) {
      throw new ConflictException(
        'Este enlace de invitación ya fue utilizado.',
      );
    }
    return {
      administratorId: payload.administratorId,
      administratorName: administrator.name,
    };
  }

  async getAdminInviteInfo(
    token: string,
  ): Promise<{ administratorName: string }> {
    const { administratorName } = await this.verifyAdminInvite(token);
    return { administratorName };
  }

  async redeemAdminInvite(
    token: string,
    dto: RedeemAdminInviteDto,
  ): Promise<LoginResult> {
    const { administratorId } = await this.verifyAdminInvite(token);

    const existing = await this.prisma.user.findFirst({
      where: { email: dto.email, deletedAt: null },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('Ya existe una cuenta con ese email.');
    }

    const passwordHash = await bcrypt.hash(dto.password, PASSWORD_HASH_ROUNDS);
    const user = await this.prisma.$transaction(async (tx) => {
      // Re-chequeado dentro de la transacción: el token es válido hasta que
      // se canjea, así que dos canjes concurrentes del mismo enlace deben
      // resolver en que solo uno gane.
      const administrator = await tx.administrator.findUnique({
        where: { id: administratorId },
        select: { primaryUserId: true },
      });
      if (administrator?.primaryUserId) {
        throw new ConflictException(
          'Este enlace de invitación ya fue utilizado.',
        );
      }
      const created = await tx.user.create({
        data: {
          email: dto.email,
          passwordHash,
          fullName: dto.fullName,
          role: 'B',
          administratorId,
          termsAcceptedAt: new Date(),
        },
      });
      await tx.administrator.update({
        where: { id: administratorId },
        data: { primaryUserId: created.id },
      });
      return created;
    });

    const estateIds = await this.resolveEstateIds(
      user.id,
      user.role,
      administratorId,
    );
    const tokens = await this.issueTokens({
      id: user.id,
      role: user.role,
      estateIds,
      administratorId,
    });
    const subscriptionStatus = await this.resolveSubscriptionStatus(
      user.role,
      administratorId,
    );

    return {
      ...tokens,
      user: {
        id: user.id,
        fullName: user.fullName,
        role: user.role,
        estateIds,
        administratorId,
        subscriptionStatus,
      },
    };
  }

  /**
   * Invitación de equipo — cualquier usuario rol B ya activo puede invitar
   * colegas a SU MISMA gestora, sin depender de rol A ni de que la empresa
   * "todavía no tenga usuario" (ese es el caso de admin-invites). El CIF de
   * la empresa no se vuelve a pedir nunca: es un dato de `Administrator`,
   * fijado una sola vez al dar de alta la gestora — un colega solo aporta
   * su propio nombre/email/contraseña.
   *
   * A diferencia del admin-invite (donde `primaryUserId === null` es la
   * única verificación de un solo uso posible), acá SÍ hace falta estado
   * persistido: puede haber varias invitaciones de equipo vivas a la vez
   * para la misma gestora, así que el token es opaco (igual que
   * RefreshToken) y su hash se guarda en `TeamInvite` — `usedAt` es el
   * guardián de un solo uso.
   */
  async createTeamInvite(user: AuthenticatedUser): Promise<{ token: string }> {
    if (!user.administratorId) {
      throw new ConflictException(
        'Tu usuario no está asociado a ninguna gestora.',
      );
    }
    const token = crypto.randomBytes(32).toString('hex');
    await this.prisma.teamInvite.create({
      data: {
        administratorId: user.administratorId,
        tokenHash: this.hashToken(token),
        createdByUserId: user.id,
        expiresAt: new Date(Date.now() + TEAM_INVITE_TTL_MS),
      },
    });
    return { token };
  }

  private async findValidTeamInvite(token: string) {
    const invite = await this.prisma.teamInvite.findUnique({
      where: { tokenHash: this.hashToken(token) },
    });
    if (!invite) {
      throw new UnauthorizedException('El enlace de invitación no es válido.');
    }
    if (invite.usedAt) {
      throw new ConflictException(
        'Este enlace de invitación ya fue utilizado.',
      );
    }
    if (invite.expiresAt < new Date()) {
      throw new UnauthorizedException('El enlace de invitación caducó.');
    }
    return invite;
  }

  async getTeamInviteInfo(
    token: string,
  ): Promise<{ administratorName: string }> {
    const invite = await this.findValidTeamInvite(token);
    const administrator = await this.prisma.administrator.findUniqueOrThrow({
      where: { id: invite.administratorId },
      select: { name: true },
    });
    return { administratorName: administrator.name };
  }

  async redeemTeamInvite(
    token: string,
    dto: RedeemTeamInviteDto,
  ): Promise<LoginResult> {
    const invite = await this.findValidTeamInvite(token);

    const existing = await this.prisma.user.findFirst({
      where: { email: dto.email, deletedAt: null },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('Ya existe una cuenta con ese email.');
    }

    const passwordHash = await bcrypt.hash(dto.password, PASSWORD_HASH_ROUNDS);
    const user = await this.prisma.$transaction(async (tx) => {
      // Re-chequeado dentro de la transacción — mismo motivo que en
      // redeemAdminInvite: dos canjes concurrentes del mismo enlace deben
      // resolver en que solo uno gane.
      const fresh = await tx.teamInvite.findUnique({
        where: { id: invite.id },
      });
      if (fresh?.usedAt) {
        throw new ConflictException(
          'Este enlace de invitación ya fue utilizado.',
        );
      }
      const created = await tx.user.create({
        data: {
          email: dto.email,
          passwordHash,
          fullName: dto.fullName,
          role: 'B',
          administratorId: invite.administratorId,
          termsAcceptedAt: new Date(),
        },
      });
      await tx.teamInvite.update({
        where: { id: invite.id },
        data: { usedAt: new Date(), usedByUserId: created.id },
      });
      return created;
    });

    const estateIds = await this.resolveEstateIds(
      user.id,
      user.role,
      invite.administratorId,
    );
    const tokens = await this.issueTokens({
      id: user.id,
      role: user.role,
      estateIds,
      administratorId: invite.administratorId,
    });
    const subscriptionStatus = await this.resolveSubscriptionStatus(
      user.role,
      invite.administratorId,
    );

    return {
      ...tokens,
      user: {
        id: user.id,
        fullName: user.fullName,
        role: user.role,
        estateIds,
        administratorId: invite.administratorId,
        subscriptionStatus,
      },
    };
  }

  /**
   * A diferencia de las invitaciones (donde alguien que YA conoce al
   * destinatario comparte el link a mano), acá quien pide el reset es la
   * propia persona bloqueada — el email real es la única forma de probar
   * que es dueña de esa cuenta. La respuesta es SIEMPRE el mismo mensaje
   * genérico exista o no ese email, para no revelar qué emails están
   * registrados.
   */
  async requestPasswordReset(email: string): Promise<{ message: string }> {
    const genericMessage =
      'Si existe una cuenta con ese email, te enviamos un enlace para restablecer la contraseña.';
    const user = await this.prisma.user.findFirst({
      where: { email, deletedAt: null },
      select: { id: true },
    });
    if (!user) {
      return { message: genericMessage };
    }

    const token = crypto.randomBytes(32).toString('hex');
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hashToken(token),
        expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
      },
    });

    const frontendUrl = resolveFrontendBaseUrl(this.configService);
    const resetUrl = `${frontendUrl}/reset-password/${token}`;
    await this.mail.sendPasswordResetEmail(email, resetUrl);

    return { message: genericMessage };
  }

  private async findValidPasswordResetToken(token: string) {
    const resetToken = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: this.hashToken(token) },
    });
    if (!resetToken) {
      throw new UnauthorizedException(
        'El enlace de recuperación no es válido.',
      );
    }
    if (resetToken.usedAt) {
      throw new ConflictException(
        'Este enlace de recuperación ya fue utilizado.',
      );
    }
    if (resetToken.expiresAt < new Date()) {
      throw new UnauthorizedException('El enlace de recuperación caducó.');
    }
    return resetToken;
  }

  async checkPasswordResetToken(token: string): Promise<{ valid: true }> {
    await this.findValidPasswordResetToken(token);
    return { valid: true };
  }

  /** No inicia sesión — a diferencia de register/redeem-invite, tras un reset se pide iniciar sesión de nuevo con la contraseña nueva. */
  async resetPassword(token: string, password: string): Promise<void> {
    const resetToken = await this.findValidPasswordResetToken(token);
    const passwordHash = await bcrypt.hash(password, PASSWORD_HASH_ROUNDS);

    await this.prisma.$transaction(async (tx) => {
      // Re-chequeado dentro de la transacción — mismo motivo que en
      // redeemTeamInvite: dos canjes concurrentes del mismo enlace deben
      // resolver en que solo uno gane.
      const fresh = await tx.passwordResetToken.findUnique({
        where: { id: resetToken.id },
      });
      if (fresh?.usedAt) {
        throw new ConflictException(
          'Este enlace de recuperación ya fue utilizado.',
        );
      }
      await tx.user.update({
        where: { id: resetToken.userId },
        data: { passwordHash },
      });
      await tx.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() },
      });
      // Buena práctica: forzar cierre de sesión en cualquier otro
      // dispositivo tras un reset de contraseña.
      await tx.refreshToken.updateMany({
        where: { userId: resetToken.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const tokenHash = this.hashToken(refreshToken);
    // findUnique (no findFirst) ahora que tokenHash es @unique: usa el índice
    // en lugar de recorrer la tabla. El `select` acotado evita traer la fila
    // completa del usuario —passwordHash incluido— en cada renovación.
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        revokedAt: true,
        expiresAt: true,
        user: {
          select: {
            id: true,
            role: true,
            administratorId: true,
            deletedAt: true,
          },
        },
      },
    });

    // `deletedAt`: hoy la única vía de baja (supresión RGPD) ya revoca los
    // tokens en su misma transacción, pero un token vivo de una cuenta
    // suprimida nunca debe renovar sesión, venga la baja de donde venga.
    if (
      !stored ||
      stored.revokedAt ||
      stored.expiresAt < new Date() ||
      stored.user.deletedAt
    ) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Rotate: revoke the old token and issue a brand new pair, so a leaked
    // refresh token cannot be replayed indefinitely.
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    const { user } = stored;
    const estateIds = await this.resolveEstateIds(
      user.id,
      user.role,
      user.administratorId,
    );
    return this.issueTokens({
      id: user.id,
      role: user.role,
      estateIds,
      administratorId: user.administratorId,
    });
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = this.hashToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      select: { userId: true },
    });
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    // Leaving the platform ends Domora staff support sessions too, so the audit
    // shows how long they really lasted (odd/tasks/role-a-panel.md L44). Best
    // effort: a failure here never blocks the logout.
    if (stored) {
      await this.supportSessions
        .endAllForStaff(stored.userId)
        .catch((error: unknown) => {
          this.logger.warn(
            `No se pudieron cerrar las sesiones de soporte al salir: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
    }
  }

  async getMe(authUser: AuthenticatedUser) {
    const user = await this.prisma.user.findFirst({
      where: { id: authUser.id, deletedAt: null },
    });
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }
    const subscriptionStatus = await this.resolveSubscriptionStatus(
      user.role,
      user.administratorId,
    );
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      phone: user.phone,
      estateIds: authUser.estateIds,
      administratorId: user.administratorId,
      subscriptionStatus,
    };
  }

  /**
   * Computes the set of estates a user is allowed to act on, encoded in the
   * JWT as `estateIds` (see doc/plan.md section 2.4 — multi-tenancy is
   * enforced at the application layer, the JWT claim is the source of
   * truth checked by EstateScopeGuard in later phases).
   *
   * - Role B (estate/community admin): every estate managed by their
   *   administrator. This is a Fase 0 simplification — `owner_properties`
   *   does not exist yet, so this is the only data we have to scope a B
   *   user. It happens to also be the correct long-term rule for B (an
   *   admin manages every estate under their `administrator_id`).
   * - Role A (platform admin/support staff): platform-wide access, not
   *   scoped to any estate set. Returned as an empty array — EstateScopeGuard
   *   (added in a later phase) must treat role 'A' as "bypass scope check"
   *   rather than reading this array, since [] would otherwise mean "no
   *   access to anything."
   * - Role C (owner/resident): every estate reachable through a `linked`
   *   `PropertyMembership` (Fase 2) — i.e. the estates of the properties
   *   the user is actually linked to, not just any property mentioning them.
   */
  private async resolveEstateIds(
    userId: string,
    role: AppRole,
    administratorId: string | null,
  ): Promise<string[]> {
    if (role === 'B' && administratorId) {
      const estates = await this.prisma.estate.findMany({
        where: { administratorId, deletedAt: null },
        select: { id: true },
      });
      return estates.map((e) => e.id);
    }
    if (role === 'C') {
      const memberships = await this.prisma.propertyMembership.findMany({
        where: { userId, status: 'linked' },
        select: { property: { select: { estateId: true } } },
      });
      const estateIds = memberships
        .map((m) => m.property.estateId)
        .filter((id): id is string => id !== null);
      return [...new Set(estateIds)];
    }
    return [];
  }

  private async issueTokens(payload: {
    id: string;
    role: AppRole;
    estateIds: string[];
    administratorId: string | null;
  }): Promise<AuthTokens> {
    const jwtPayload: JwtPayload = {
      sub: payload.id,
      role: payload.role,
      estateIds: payload.estateIds,
      administratorId: payload.administratorId,
    };

    const accessToken = await this.jwtService.signAsync(jwtPayload, {
      // See AuthModule for why this cast to ms's StringValue is needed.
      expiresIn:
        (this.configService.get<string>('JWT_ACCESS_EXPIRES') as StringValue) ??
        '15m',
    });

    const refreshToken = crypto.randomBytes(48).toString('hex');
    await this.prisma.refreshToken.create({
      data: {
        userId: payload.id,
        tokenHash: this.hashToken(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
    });

    return { accessToken, refreshToken };
  }

  /**
   * Refresh tokens are opaque random strings, never stored in plaintext —
   * only a SHA-256 hash is persisted, mirroring how passwords are hashed.
   * Unlike bcrypt for passwords, SHA-256 is appropriate here because the
   * input is already a high-entropy random token (not a low-entropy
   * user-chosen secret), so there is no brute-force risk to slow down.
   */
  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }
}
