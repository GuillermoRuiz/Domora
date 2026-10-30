import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

/**
 * Envío de email real (Fase de recuperación de contraseña). No hay
 * credenciales SMTP reales que se puedan inventar en este entorno — si
 * `SMTP_HOST` no está configurado (caso por defecto en desarrollo), degrada
 * a loguear el email por consola en vez de fallar. En producción basta con
 * setear SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/SMTP_FROM para que empiece
 * a enviar de verdad — el resto del código no cambia.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: nodemailer.Transporter | null;
  private readonly from: string;

  constructor(private readonly configService: ConfigService) {
    this.from =
      this.configService.get<string>('SMTP_FROM') ??
      'Domora <no-reply@domora.app>';

    const host = this.configService.get<string>('SMTP_HOST');
    if (!host) {
      this.transporter = null;
      return;
    }
    this.transporter = nodemailer.createTransport({
      host,
      port: Number(this.configService.get<string>('SMTP_PORT') ?? 587),
      secure: this.configService.get<string>('SMTP_SECURE') === 'true',
      auth: {
        user: this.configService.get<string>('SMTP_USER'),
        pass: this.configService.get<string>('SMTP_PASS'),
      },
    });
  }

  private async send(
    to: string,
    subject: string,
    text: string,
    html: string,
  ): Promise<void> {
    if (!this.transporter) {
      this.logger.warn(
        `SMTP_HOST no configurado — email NO enviado de verdad. Para: ${to} · Asunto: "${subject}"\n${text}`,
      );
      return;
    }
    await this.transporter.sendMail({
      from: this.from,
      to,
      subject,
      text,
      html,
    });
  }

  /**
   * Email genérico de un aviso de la bandeja de notificaciones
   * (`NotificationsService`). `title` y `body` pueden llevar texto que
   * introdujo un usuario (nombres, activos…), por eso se escapan antes de
   * meterlos en el HTML.
   */
  async sendNotificationEmail(
    to: string,
    title: string,
    body: string | null,
    url: string,
  ): Promise<void> {
    const escape = (value: string) =>
      value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    const text = `${title}${body ? `\n\n${body}` : ''}\n\nAbrir en Domora: ${url}`;
    const html = `
      <p><strong>${escape(title)}</strong></p>
      ${body ? `<p>${escape(body)}</p>` : ''}
      <p><a href="${escape(url)}">Abrir en Domora</a></p>
    `;
    await this.send(to, title, text, html);
  }

  async sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
    const subject = 'Recuperar tu contraseña de Domora';
    const text = `Recibimos una solicitud para restablecer tu contraseña. Abre este enlace (válido durante 1 hora) para elegir una nueva:\n\n${resetUrl}\n\nSi no fuiste tú, puedes ignorar este email.`;
    const html = `
      <p>Recibimos una solicitud para restablecer tu contraseña de Domora.</p>
      <p><a href="${resetUrl}">Elige una nueva contraseña</a> (enlace válido durante 1 hora).</p>
      <p>Si no fuiste tú, puedes ignorar este email — tu contraseña actual sigue siendo válida.</p>
    `;
    await this.send(to, subject, text, html);
  }

  /**
   * Invitación a la sala de espera de una junta con videollamada. Se envía
   * en BCC desde `MeetingsService.create` (un email por destinatario, nunca
   * en el `to` de todos a la vez) para no filtrar la lista de convocados
   * entre sí — mismo motivo que el original en React.
   */
  async sendMeetingInvite(
    to: string,
    meetingTitle: string,
    waitRoomUrl: string,
    password: string | null,
  ): Promise<void> {
    const subject = `Convocatoria: ${meetingTitle}`;
    const passwordLine = password ? `\nContraseña de acceso: ${password}` : '';
    const passwordHtml = password
      ? `<p>Contraseña de acceso: <strong>${password}</strong></p>`
      : '';
    const text = `Has sido convocado a la junta "${meetingTitle}". Entra a la sala de espera desde este enlace cuando vaya a empezar:\n\n${waitRoomUrl}${passwordLine}`;
    const html = `
      <p>Has sido convocado a la junta <strong>${meetingTitle}</strong>.</p>
      <p>Entra a la <a href="${waitRoomUrl}">sala de espera</a> desde este enlace cuando vaya a empezar.</p>
      ${passwordHtml}
    `;
    await this.send(to, subject, text, html);
  }

  /**
   * Aviso de comunicado urgente / notificación fehaciente. Un email por
   * destinatario (nunca BCC/CC a todos), mismo motivo que
   * `sendMeetingInvite`: no filtrar entre vecinos quién más recibió el aviso.
   */
  async sendCommunicationNotice(
    to: string,
    title: string,
    bodyPreview: string,
    boardUrl: string,
    isLegalNotice: boolean,
  ): Promise<void> {
    const subject = isLegalNotice
      ? `Notificación fehaciente: ${title}`
      : `Aviso urgente: ${title}`;
    const intro = isLegalNotice
      ? 'Se ha publicado una notificación fehaciente'
      : 'Se ha publicado un aviso urgente';
    const text = `${intro} en el tablón de tu comunidad:\n\n"${title}"\n${bodyPreview}\n\nVerlo completo: ${boardUrl}`;
    const html = `
      <p>${intro} en el tablón de tu comunidad.</p>
      <p><strong>${title}</strong><br>${bodyPreview}</p>
      <p><a href="${boardUrl}">Ver comunicado completo</a></p>
    `;
    await this.send(to, subject, text, html);
  }

  /** El acta ya está firmada por presidente y secretario (art. 19 LPH) — se distribuye a todos los propietarios, presentes o no. */
  async sendActaNotice(to: string, meetingTitle: string, downloadUrl: string): Promise<void> {
    const subject = `Acta disponible: ${meetingTitle}`;
    const text = `El acta de la junta "${meetingTitle}" ya está firmada y disponible para su descarga:\n\n${downloadUrl}`;
    const html = `
      <p>El acta de la junta <strong>${meetingTitle}</strong> ya está firmada y disponible.</p>
      <p><a href="${downloadUrl}">Descargar acta</a></p>
    `;
    await this.send(to, subject, text, html);
  }

  /** Evento síncrono, disparado desde VoteSessionsService.open() — no pasa por el cron. */
  async sendVoteSessionOpened(to: string, meetingTitle: string, questionTitle: string): Promise<void> {
    const subject = `Votación abierta: ${meetingTitle}`;
    const text = `Se abrió una votación en la junta "${meetingTitle}": "${questionTitle}".`;
    const html = `<p>Se abrió una votación en la junta <strong>${meetingTitle}</strong>: "${questionTitle}".</p>`;
    await this.send(to, subject, text, html);
  }

  /** Recordatorio diario (MeetingsNotificationsCronService) mientras el acta siga sin firmar dentro del plazo del art. 19 LPH (10 días naturales). */
  async sendActaReadyToSign(to: string, meetingTitle: string, daysRemaining: number): Promise<void> {
    const subject = `Acta pendiente de firma: ${meetingTitle}`;
    const whenLine =
      daysRemaining <= 0
        ? 'el plazo de 10 días naturales para firmarla ya venció'
        : daysRemaining === 1
          ? 'queda 1 día para el plazo de 10 días naturales'
          : `quedan ${daysRemaining} días para el plazo de 10 días naturales`;
    const text = `El acta de la junta "${meetingTitle}" todavía no está firmada — ${whenLine} (art. 19 LPH).`;
    const html = `<p>El acta de la junta <strong>${meetingTitle}</strong> todavía no está firmada — ${whenLine} (art. 19 LPH).</p>`;
    await this.send(to, subject, text, html);
  }

  private membershipRoleLabel(roleType: string): string {
    switch (roleType) {
      case 'Inquilino':
        return 'inquilino';
      case 'Representante':
        return 'representante';
      case 'Ocupante':
        return 'ocupante';
      default:
        return roleType.toLowerCase();
    }
  }

  /** Invitación a vincularse a una propiedad ya existente — disparada desde `PropertyMembershipInvitesService.createInvite`/`resendInvite`. */
  async sendMembershipInvite(
    to: string,
    roleType: string,
    propertyAddress: string,
    estateName: string | null,
    inviteUrl: string,
  ): Promise<void> {
    const roleLabel = this.membershipRoleLabel(roleType);
    const placeLabel = [propertyAddress, estateName].filter(Boolean).join(', ');
    const subject = `Invitación a unirte a ${estateName ?? 'tu comunidad'} en Domora`;
    const text = `Te han invitado a vincularte como ${roleLabel} a ${placeLabel} en Domora. Abre este enlace (válido 7 días) para aceptar:\n\n${inviteUrl}`;
    const html = `
      <p>Te han invitado a vincularte como <strong>${roleLabel}</strong> a <strong>${placeLabel}</strong> en Domora.</p>
      <p><a href="${inviteUrl}">Aceptar invitación</a> (enlace válido 7 días).</p>
    `;
    await this.send(to, subject, text, html);
  }

  /** Recordatorio (PropertyMembershipInvitesCronService) mientras la invitación siga sin canjear cerca de su caducidad de 7 días. */
  async sendMembershipInviteReminder(
    to: string,
    roleType: string,
    propertyAddress: string,
    daysRemaining: number,
  ): Promise<void> {
    const roleLabel = this.membershipRoleLabel(roleType);
    const whenLine =
      daysRemaining <= 0
        ? 'está a punto de caducar'
        : daysRemaining === 1
          ? 'caduca en 1 día'
          : `caduca en ${daysRemaining} días`;
    const subject = `Tu invitación a ${propertyAddress} ${whenLine}`;
    const text = `Tu invitación pendiente como ${roleLabel} a ${propertyAddress} ${whenLine}. Pídele a quien te invitó que te reenvíe el enlace si todavía no te uniste.`;
    const html = `<p>Tu invitación pendiente como <strong>${roleLabel}</strong> a <strong>${propertyAddress}</strong> ${whenLine}.</p><p>Pídele a quien te invitó que te reenvíe el enlace si todavía no te uniste.</p>`;
    await this.send(to, subject, text, html);
  }

}
