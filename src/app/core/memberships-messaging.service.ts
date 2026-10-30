import { Injectable, inject } from '@angular/core';
import { ApiClientService } from './api-client.service';
import { AuthService } from './auth.service';
import {
  User, PropertyMembership, UserRepresentation, MembershipSettings,
  DirectMessageContact, ConversationSummary, DirectMessage, UserMessagingSettings,
  InvitableMembershipRoleType, MembershipInviteInfo, CreatedMembershipInvite, PendingMembershipInvite,
} from './models';

/** Identidad del usuario en sesión, membresías propietario↔propiedad, mensajería directa y representación entre usuarios. */
@Injectable({ providedIn: 'root' })
export class MembershipsMessagingService {
  private api = inject(ApiClientService);
  private auth = inject(AuthService);

  /** Id del usuario autenticado (JWT) — para vistas "mis X". */
  currentUserId(): string {
    return this.auth.currentUser()?.id ?? '';
  }

  // ── Users ────────────────────────────────────────────────────────────────
  // TODO(backend): no hay endpoints GET /users/:id ni búsqueda por email/taxId.
  async findUserById(id: string): Promise<User | null> {
    return null;
  }

  // TODO(backend): pendiente endpoint de búsqueda de usuarios por email.
  async findUserByEmail(email: string): Promise<User | null> {
    return null;
  }

  // TODO(backend): pendiente endpoint de búsqueda de usuarios por taxId.
  async findUserByTaxId(country: string, taxId: string): Promise<User | null> {
    return null;
  }

  /**
   * Nombre de display de un usuario. Los objetos de la API ya incluyen el
   * usuario embebido donde procede (memberships, adhesiones) — pásalo como
   * `apiName`. Helper síncrono con fallback.
   */
  resolveUserName(userId: string | null | undefined, fallback = '', apiName?: string): string {
    if (apiName) return apiName;
    if (!userId) return fallback;
    if (userId === this.auth.currentUser()?.id) {
      return this.auth.currentUser()?.fullName ?? fallback;
    }
    return fallback;
  }

  // ── Property memberships ─────────────────────────────────────────────────
  listMembershipsByProperty(propertyId: string): Promise<PropertyMembership[]> {
    return this.api.get<PropertyMembership[]>(`/properties/${propertyId}/memberships`);
  }

  listMembershipsByUser(userId?: string): Promise<PropertyMembership[]> {
    const id = userId ?? this.auth.currentUser()?.id ?? '';
    return this.api.get<PropertyMembership[]>(`/users/${id}/memberships`);
  }

  async findPrimaryContact(propertyId: string): Promise<{ membership: PropertyMembership; user: User } | null> {
    const m = await this.api.getOrNull<any>(`/properties/${propertyId}/memberships/primary-contact`);
    if (!m) return null;
    return { membership: m, user: m.user ?? null };
  }

  /** Mis ajustes de privacidad/notificaciones para esta propiedad concreta. */
  getMembershipSettings(propertyId: string): Promise<MembershipSettings> {
    return this.api.get<MembershipSettings>(`/properties/${propertyId}/memberships/me/settings`);
  }

  updateMembershipSettings(
    propertyId: string,
    patch: Partial<MembershipSettings>,
  ): Promise<MembershipSettings> {
    return this.api.patch<MembershipSettings>(`/properties/${propertyId}/memberships/me/settings`, patch);
  }

  /** Alta dirigida: el primary contact de la propiedad (o un rol A/B con acceso a su finca) invita a un inquilino/representante/ocupante — devuelve el token para compartir el link a mano, sin envío de email. */
  createMembershipInvite(
    propertyId: string,
    roleType: InvitableMembershipRoleType,
    inviteeEmail: string,
  ): Promise<CreatedMembershipInvite> {
    return this.api.post<CreatedMembershipInvite>(`/properties/${propertyId}/memberships/invites`, { roleType, inviteeEmail });
  }

  /**
   * Invita como Propietario a un titular importado (solo rol A/B). El email
   * sale del titular, no del formulario, y solo puede aceptarla la cuenta
   * de ese email.
   */
  createOwnerInvite(propertyId: string, externalOwnerId: string): Promise<CreatedMembershipInvite> {
    return this.api.post<CreatedMembershipInvite>(`/properties/${propertyId}/memberships/owner-invites`, { externalOwnerId });
  }

  /** Invitaciones aún no canjeadas — las canjeadas ya aparecen como `PropertyMembership` en `listMembershipsByProperty`. */
  listPendingInvites(propertyId: string): Promise<PendingMembershipInvite[]> {
    return this.api.get<PendingMembershipInvite[]>(`/properties/${propertyId}/memberships/invites`);
  }

  /** Rota el token (el enlace anterior deja de funcionar), extiende 7 días y reenvía el email. */
  resendMembershipInvite(propertyId: string, inviteId: string): Promise<CreatedMembershipInvite> {
    return this.api.post<CreatedMembershipInvite>(`/properties/${propertyId}/memberships/invites/${inviteId}/resend`, {});
  }

  revokeMembershipInvite(propertyId: string, inviteId: string): Promise<void> {
    return this.api.patch<void>(`/properties/${propertyId}/memberships/invites/${inviteId}/revoke`, {});
  }

  /** Info pública del invite (dirección/finca/rol) para la landing `/membership-invite/:token`, antes de saber si hay sesión iniciada. */
  getMembershipInviteInfo(token: string): Promise<MembershipInviteInfo> {
    return this.api.get<MembershipInviteInfo>(`/membership-invites/${token}`);
  }

  /** Requiere sesión iniciada — adjunta la membresía al usuario autenticado, no crea cuenta nueva. */
  redeemMembershipInvite(token: string): Promise<PropertyMembership> {
    return this.api.post<PropertyMembership>(`/membership-invites/${token}/redeem`, {});
  }

  /** Baja puntual de una membresía ya vinculada — la puede pedir el primary contact de la propiedad o un rol A/B como respaldo administrativo. `promoteMembershipId` solo hace falta al revocar al único primary contact activo. */
  revokeMembership(propertyId: string, membershipId: string, promoteMembershipId?: string): Promise<PropertyMembership> {
    return this.api.patch<PropertyMembership>(`/properties/${propertyId}/memberships/${membershipId}`, { promoteMembershipId });
  }

  // ── Mensajería directa (usuarios de una misma finca) ──────────────────────
  listMessageContacts(estateId?: string): Promise<DirectMessageContact[]> {
    return this.api.get<DirectMessageContact[]>('/direct-messages/contacts', { estateId });
  }

  listConversations(estateId?: string): Promise<ConversationSummary[]> {
    return this.api.get<ConversationSummary[]>('/direct-messages/conversations', { estateId });
  }

  listConversationMessages(conversationId: string, opts?: { limit?: number; before?: string }): Promise<DirectMessage[]> {
    return this.api.get<DirectMessage[]>(`/direct-messages/conversations/${conversationId}/messages`, {
      limit: opts?.limit,
      before: opts?.before,
    });
  }

  sendDirectMessage(payload: { recipientUserId?: string; conversationId?: string; text: string }): Promise<DirectMessage> {
    return this.api.post<DirectMessage>('/direct-messages/messages', payload);
  }

  sendDirectMessageWithAttachments(payload: { recipientUserId?: string; conversationId?: string; text: string }, files: File[]): Promise<DirectMessage> {
    const form = new FormData();
    if (payload.recipientUserId) form.append('recipientUserId', payload.recipientUserId);
    if (payload.conversationId) form.append('conversationId', payload.conversationId);
    form.append('text', payload.text);
    for (const file of files) form.append('files', file, file.name);
    return this.api.post<DirectMessage>('/direct-messages/messages/with-attachments', form);
  }

  /** Solo el autor: cambia el texto y el mensaje pasa a mostrarse como «editado». */
  editDirectMessage(messageId: string, text: string): Promise<DirectMessage> {
    return this.api.patch<DirectMessage>(`/direct-messages/messages/${messageId}`, { text });
  }

  /** Solo el autor: el mensaje queda como «borrado» en el hilo, sin texto ni adjuntos. */
  deleteDirectMessage(messageId: string): Promise<{ id: string; deletedAt: string }> {
    return this.api.delete<{ id: string; deletedAt: string }>(`/direct-messages/messages/${messageId}`);
  }

  downloadMessageAttachment(attachmentId: string): Promise<Blob> {
    return this.api.getBlob(`/direct-messages/attachments/${attachmentId}/file`);
  }

  /** «Eliminar conversación»: la oculta solo para quien la elimina; el historial reaparece si cualquiera escribe de nuevo. */
  deleteConversation(conversationId: string): Promise<void> {
    return this.api.delete<void>(`/direct-messages/conversations/${conversationId}`);
  }

  async markConversationRead(conversationId: string): Promise<void> {
    await this.api.patch(`/direct-messages/conversations/${conversationId}/read`, {});
  }

  /** Ajustes globales de mensajería para usuarios sin propiedad (rol A/B). */
  getMyMessagingSettings(): Promise<UserMessagingSettings> {
    return this.api.get<UserMessagingSettings>('/direct-messages/settings');
  }

  updateMyMessagingSettings(patch: Partial<UserMessagingSettings>): Promise<UserMessagingSettings> {
    return this.api.patch<UserMessagingSettings>('/direct-messages/settings', patch);
  }

  // ── User representations ─────────────────────────────────────────────────
  listActiveRepresentationsFor(userId: string, _at?: string): Promise<UserRepresentation[]> {
    return this.api.get<UserRepresentation[]>(`/users/${userId}/representations/active`);
  }

  async canActOnBehalfOf(
    actorUserId: string,
    representedUserId: string,
    opts?: { estateId?: string; propertyId?: string; at?: string },
  ): Promise<boolean> {
    const res = await this.api.get<{ canAct: boolean }>(
      `/users/${actorUserId}/representations/can-act-on-behalf-of/${representedUserId}`,
      { estateId: opts?.estateId, propertyId: opts?.propertyId },
    );
    return res.canAct;
  }
}
