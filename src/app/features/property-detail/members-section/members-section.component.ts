import { Component, Input, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BadgeComponent } from '../../../shared/components/badge/badge.component';
import { BtnComponent } from '../../../shared/components/btn/btn.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import {
  CreatedMembershipInvite,
  InvitableMembershipRoleType,
  MembershipRoleType,
  PendingMembershipInvite,
  PendingMembershipInviteStatus,
  PropertyMembership,
} from '../../../core/models';
import { MembershipsMessagingService } from '../../../core/memberships-messaging.service';
import { AuthService } from '../../../core/auth.service';

import { SelectDropdownDirective } from '../../../shared/components/dropdown/select-dropdown.directive';
const INVITABLE_ROLE_OPTIONS: { value: InvitableMembershipRoleType; label: string }[] = [
  { value: 'Inquilino', label: 'Inquilino' },
  { value: 'Representante', label: 'Representante' },
  { value: 'Ocupante', label: 'Ocupante' },
];

const ROLE_BADGE_VARIANT: Record<MembershipRoleType, string> = {
  Propietario: 'primary', Inquilino: 'default', Representante: 'default', Ocupante: 'default', Otro: 'default',
};

const INVITE_STATUS_LABEL: Record<PendingMembershipInviteStatus, string> = {
  pending: 'Pendiente',
  expiring_soon: 'Caduca pronto',
  expired: 'Caducada',
  revoked: 'Revocada',
};

const INVITE_STATUS_VARIANT: Record<PendingMembershipInviteStatus, string> = {
  pending: 'warning',
  expiring_soon: 'warning',
  expired: 'error',
  revoked: 'default',
};

// Mismo criterio que el @IsEmail del backend a efectos de UX — el backend sigue siendo quien valida de verdad.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Lista de miembros (propietarios/inquilinos/representantes/ocupantes) de
 * una propiedad, con alta por invitación y baja puntual — reutilizada tanto
 * en `property-detail` (el propio propietario autogestiona) como en un
 * modal de `estate-detail` (el admin B como respaldo administrativo, ver
 * doc del plan de la tarea 14). `canInvite`/`canRevoke` habilitan cada
 * acción por separado porque los dos consumidores necesitan una
 * combinación distinta.
 *
 * `canInvite`/`canRevoke` dicen qué ofrece el CONSUMIDOR, no qué permite el
 * backend: `assertCanManageMembers` solo deja gestionar a un rol A/B o al
 * titular principal de ESTA propiedad. Sin cruzarlo con eso, un cotitular
 * no principal veía los botones y recibía un 403 disfrazado de toast
 * genérico — por eso `canManage` los filtra aquí.
 */
@Component({
  selector: 'app-members-section',
  standalone: true,
  imports: [FormsModule, BadgeComponent, BtnComponent, IconComponent, SelectDropdownDirective],
  templateUrl: './members-section.component.html',
  styleUrl: './members-section.component.scss',
})
export class MembersSectionComponent implements OnInit {
  @Input({ required: true }) propertyId!: string;
  @Input() canInvite = false;
  @Input() canRevoke = false;
  /**
   * Muestra (y deja reenviar/revocar) las invitaciones pendientes aunque no
   * se ofrezca "Invitar inquilino" — la gestora invita a los propietarios
   * importados desde estate-detail y necesita seguirlas aquí.
   */
  @Input() showInvites = false;

  private membershipsSvc = inject(MembershipsMessagingService);
  private auth = inject(AuthService);

  members = signal<PropertyMembership[]>([]);
  loading = signal(true);
  toastMessage = signal<string | null>(null);

  roleOptions = INVITABLE_ROLE_OPTIONS;

  linkedMembers = computed(() => this.members().filter((m) => m.status === 'linked'));

  private isManagerRole = computed(() => {
    const role = this.auth.currentUser()?.role;
    return role === 'A' || role === 'B';
  });

  isPrimaryContactMe = computed(() => {
    const me = this.membershipsSvc.currentUserId();
    return this.members().some((m) => m.userId === me && m.isPrimaryContact && m.status === 'linked');
  });

  canManage = computed(() => this.isManagerRole() || this.isPrimaryContactMe());

  // ── Invitar ──────────────────────────────────────────────────────────
  showInviteModal = signal(false);
  inviteRoleType = signal<InvitableMembershipRoleType>('Inquilino');
  inviteEmail = signal('');
  inviting = signal(false);
  inviteResult = signal<(CreatedMembershipInvite & { email: string }) | null>(null);

  inviteEmailValid = computed(() => EMAIL_PATTERN.test(this.inviteEmail().trim()));

  // ── Invitaciones pendientes ─────────────────────────────────────────
  pendingInvites = signal<PendingMembershipInvite[]>([]);
  inviteActionBusyId = signal<string | null>(null);

  // ── Revocar (con promoción si es el primary contact) ────────────────
  revokeTarget = signal<PropertyMembership | null>(null);
  promoteTargetId = signal('');
  revoking = signal(false);

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  showInviteActions(): boolean {
    return this.canInvite && this.canManage();
  }

  showRevokeActions(): boolean {
    return this.canRevoke && this.canManage();
  }

  showPendingInvites(): boolean {
    return (this.canInvite || this.showInvites) && this.canManage();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.members.set(await this.membershipsSvc.listMembershipsByProperty(this.propertyId));
    } catch (error) {
      console.error('Error cargando los miembros de la propiedad', error);
    } finally {
      this.loading.set(false);
    }
    // Depende de `members()` (para saber si soy titular principal), por eso va después y no en paralelo.
    if (this.showPendingInvites()) {
      await this.loadPendingInvites();
    }
  }

  private async loadPendingInvites(): Promise<void> {
    try {
      this.pendingInvites.set(await this.membershipsSvc.listPendingInvites(this.propertyId));
    } catch (error) {
      console.error('Error cargando las invitaciones pendientes', error);
    }
  }

  private showToast(msg: string): void {
    this.toastMessage.set(msg);
    setTimeout(() => this.toastMessage.set(null), 2500);
  }

  roleBadgeVariant(role: MembershipRoleType): string {
    return ROLE_BADGE_VARIANT[role] ?? 'default';
  }

  statusBadgeVariant(status: PropertyMembership['status']): string {
    if (status === 'linked') return 'green';
    if (status === 'pending') return 'warning';
    return 'error';
  }

  inviteStatusLabel(status: PendingMembershipInviteStatus): string {
    return INVITE_STATUS_LABEL[status];
  }

  inviteStatusVariant(status: PendingMembershipInviteStatus): string {
    return INVITE_STATUS_VARIANT[status];
  }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  // ── Invitar ──────────────────────────────────────────────────────────
  openInviteModal(): void {
    this.inviteRoleType.set('Inquilino');
    this.inviteEmail.set('');
    this.inviteResult.set(null);
    this.showInviteModal.set(true);
  }

  closeInviteModal(): void {
    this.showInviteModal.set(false);
  }

  async submitInvite(): Promise<void> {
    if (!this.inviteEmailValid()) return;
    const email = this.inviteEmail().trim();
    this.inviting.set(true);
    try {
      const created = await this.membershipsSvc.createMembershipInvite(this.propertyId, this.inviteRoleType(), email);
      this.inviteResult.set({ ...created, email });
      await this.loadPendingInvites();
    } catch (error) {
      console.error('Error creando la invitación', error);
      this.showToast('No se pudo generar la invitación');
    } finally {
      this.inviting.set(false);
    }
  }

  copyInviteLink(): void {
    const link = this.inviteResult()?.inviteUrl;
    if (!link) return;
    navigator.clipboard.writeText(link);
    this.showToast('Enlace copiado al portapapeles');
  }

  // ── Invitaciones pendientes ─────────────────────────────────────────
  async resendInvite(invite: PendingMembershipInvite): Promise<void> {
    this.inviteActionBusyId.set(invite.id);
    try {
      await this.membershipsSvc.resendMembershipInvite(this.propertyId, invite.id);
      await this.loadPendingInvites();
      this.showToast(`Invitación reenviada a ${invite.inviteeEmail}`);
    } catch (error) {
      console.error('Error reenviando la invitación', error);
      this.showToast('No se pudo reenviar la invitación');
    } finally {
      this.inviteActionBusyId.set(null);
    }
  }

  async revokeInvite(invite: PendingMembershipInvite): Promise<void> {
    if (!confirm(`¿Revocar la invitación a ${invite.inviteeEmail}? El enlace dejará de funcionar.`)) return;
    this.inviteActionBusyId.set(invite.id);
    try {
      await this.membershipsSvc.revokeMembershipInvite(this.propertyId, invite.id);
      await this.loadPendingInvites();
      this.showToast('Invitación revocada');
    } catch (error) {
      console.error('Error revocando la invitación', error);
      this.showToast('No se pudo revocar la invitación');
    } finally {
      this.inviteActionBusyId.set(null);
    }
  }

  // ── Revocar ──────────────────────────────────────────────────────────
  otherLinkedMembers(target: PropertyMembership): PropertyMembership[] {
    return this.linkedMembers().filter((m) => m.id !== target.id);
  }

  memberLabel(m: PropertyMembership): string {
    return m.user?.fullName ?? m.roleType;
  }

  async startRevoke(m: PropertyMembership): Promise<void> {
    if (!m.isPrimaryContact) {
      if (!confirm(`¿Revocar la membresía de ${this.memberLabel(m)}?`)) return;
      await this.doRevoke(m);
      return;
    }
    // Titular principal: hace falta elegir a quién promover antes de revocar.
    this.revokeTarget.set(m);
    this.promoteTargetId.set(this.otherLinkedMembers(m)[0]?.id ?? '');
  }

  closeRevokeModal(): void {
    this.revokeTarget.set(null);
    this.promoteTargetId.set('');
  }

  async confirmPromoteAndRevoke(): Promise<void> {
    const target = this.revokeTarget();
    if (!target || !this.promoteTargetId()) return;
    await this.doRevoke(target, this.promoteTargetId());
    this.closeRevokeModal();
  }

  private async doRevoke(m: PropertyMembership, promoteMembershipId?: string): Promise<void> {
    this.revoking.set(true);
    try {
      await this.membershipsSvc.revokeMembership(this.propertyId, m.id, promoteMembershipId);
      await this.load();
      this.showToast(`Membresía de ${this.memberLabel(m)} revocada`);
    } catch (error) {
      console.error('Error revocando la membresía', error);
      this.showToast('No se pudo revocar la membresía');
    } finally {
      this.revoking.set(false);
    }
  }
}
