import { Component, ElementRef, HostListener, Injector, OnDestroy, OnInit, afterNextRender, computed, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TopbarComponent } from '../../layout/topbar/topbar.component';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { BtnComponent } from '../../shared/components/btn/btn.component';
import { AvatarComponent } from '../../shared/components/avatar/avatar.component';
import { BadgeComponent } from '../../shared/components/badge/badge.component';
import { DateRangePickerComponent } from '../../shared/components/date-range-picker/date-range-picker.component';
import { SelectDropdownDirective } from '../../shared/components/dropdown/select-dropdown.directive';
import { AssistantChatComponent } from '../../shared/components/assistant-chat/assistant-chat.component';
import { ConversationSummary, DirectMessage, DirectMessageAttachment, DirectMessageContact } from '../../core/models';
import { MembershipsMessagingService } from '../../core/memberships-messaging.service';
import { AssistantEstate, AssistantService } from '../../core/assistant.service';
import { AuthService } from '../../core/auth.service';
import { CommunityScopeService } from '../../core/community-scope.service';
import { StateService } from '../../core/state.service';
import { ClampOverflowDirective } from './clamp-overflow.directive';
import { filterConversations, formatConversationDate, formatFileSize, normalizeMessageSearch, type InboxFilters } from './mensajes.util';

const POLL_INTERVAL_MS = 15000;
const ACCEPT_ALL = '.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.xml,.png,.jpg,.jpeg,.webp';
export const DELETED_MESSAGE_TEXT = 'Este mensaje ha sido borrado';
const ALLOWED_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/xml', 'text/xml', 'text/plain', 'text/csv']);

@Component({
  selector: 'app-mensajes', standalone: true,
  imports: [TopbarComponent, IconComponent, BtnComponent, AvatarComponent, BadgeComponent, FormsModule, AssistantChatComponent, SelectDropdownDirective, DateRangePickerComponent, ClampOverflowDirective],
  templateUrl: './mensajes.component.html', styleUrl: './mensajes.component.scss',
})
export class MensajesComponent implements OnInit, OnDestroy {
  private readonly data = inject(MembershipsMessagingService);
  private readonly assistant = inject(AssistantService);
  private readonly auth = inject(AuthService);
  private readonly state = inject(StateService);
  private readonly route = inject(ActivatedRoute);
  private readonly injector = inject(Injector);
  private readonly messageList = viewChild<ElementRef<HTMLDivElement>>('messageList');
  private readonly contactSearch = viewChild<ElementRef<HTMLInputElement>>('contactSearch');
  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private listRequest = 0;
  private threadRequest = 0;
  private destroyed = false;
  private composeReturnFocus: HTMLElement | null = null;

  readonly conversations = signal<ConversationSummary[]>([]);
  readonly estates = signal<AssistantEstate[]>([]);
  private readonly communityScope = inject(CommunityScopeService);
  readonly selectedEstateId = signal(this.communityScope.estateId() ?? '');
  readonly estateOptions = computed(() => this.estates().length ? this.estates() : this.communityScope.cachedEstates());
  readonly scopeLoading = signal(true);
  readonly scopeError = signal(false);
  readonly activeConversationId = signal<string | null>(null);
  readonly messages = signal<DirectMessage[]>([]);
  readonly messageText = signal('');
  readonly menuMessageId = signal<string | null>(null);
  readonly confirmDeleteId = signal<string | null>(null);
  readonly editingId = signal<string | null>(null);
  readonly editText = signal('');
  readonly savingEdit = signal(false);
  readonly acceptAll = ACCEPT_ALL;
  readonly deletedText = DELETED_MESSAGE_TEXT;
  readonly draftFiles = signal<File[]>([]);
  readonly loading = signal(true);
  readonly threadLoading = signal(false);
  readonly sending = signal(false);
  readonly error = signal('');
  readonly domoActive = signal(false);
  readonly pendingContact = signal<DirectMessageContact | null>(null);
  readonly showCompose = signal(false);
  readonly showThreadMenu = signal(false);
  readonly confirmDeleteConversation = signal(false);
  readonly contacts = signal<DirectMessageContact[]>([]);
  readonly composeSearch = signal('');
  readonly contactsLoading = signal(false);
  readonly contactsError = signal(false);
  readonly filters = signal<InboxFilters>({ search: '', unreadOnly: false, range: null, sort: 'recent' });
  readonly pinnedIds = signal<string[]>(this.readPins());
  readonly downloadingIds = signal<string[]>([]);
  /** Mensajes largos: los que no caben en 10 líneas y los que el usuario ya ha desplegado con «Leer más». */
  readonly overflowIds = signal<string[]>([]);
  readonly expandedIds = signal<string[]>([]);
  readonly formatDate = formatConversationDate;
  readonly fileSize = formatFileSize;

  get userId(): string { return this.auth.currentUser()?.id ?? ''; }
  get userName(): string { return this.auth.currentUser()?.fullName ?? 'Tú'; }
  readonly activeConversation = computed(() => this.conversations().find(c => c.id === this.activeConversationId()) ?? null);
  readonly hasActiveThread = computed(() => this.activeConversationId() !== null || this.pendingContact() !== null);
  readonly threadTitle = computed(() => this.activeConversation()?.otherDisplayName ?? this.pendingContact()?.displayName ?? '');
  readonly selectedEstate = computed(() => this.estates().find(e => e.id === this.selectedEstateId()) ?? null);
  readonly threadCommunity = computed(() => this.estates().find(e => e.id === (this.activeConversation()?.estateId ?? this.pendingContact()?.estateId))?.name ?? this.selectedEstate()?.name ?? 'Mensaje directo');
  readonly filteredConversations = computed(() => filterConversations(this.conversations(), this.filters(), this.pinnedIds()));
  readonly showDomoRow = computed(() => {
    const f = this.filters();
    return !f.unreadOnly && !f.range && (!f.search || 'domo asistente'.includes(normalizeMessageSearch(f.search)));
  });
  readonly unreadTotal = computed(() => this.conversations().reduce((sum, row) => sum + Number(row.unreadCount > 0), 0));
  readonly filteredContacts = computed(() => {
    const query = normalizeMessageSearch(this.composeSearch());
    return this.contacts().filter(c => normalizeMessageSearch(c.displayName).includes(query));
  });

  async ngOnInit(): Promise<void> {
    await Promise.all([this.reloadConversations(), this.loadEstates()]);
    if (this.destroyed) return;
    await this.openFromQueryParam();
    if (!this.destroyed) this.pollHandle = setInterval(() => void this.poll(), POLL_INTERVAL_MS);
  }

  ngOnDestroy(): void { this.destroyed = true; if (this.pollHandle) clearInterval(this.pollHandle); }

  async loadEstates(): Promise<void> {
    this.scopeLoading.set(true); this.scopeError.set(false);
    try { this.estates.set(await this.assistant.listEstates()); }
    catch { this.scopeError.set(true); }
    finally { this.scopeLoading.set(false); }
  }

  /** `remember` = false cuando la comunidad se fija sola (p. ej. al redactar sin ninguna elegida): no debe cambiar la compartida. */
  async changeEstate(estateId: string, remember = true): Promise<void> {
    if (this.sending() || (estateId && !this.estates().some(e => e.id === estateId))) return;
    const keepDomo = this.domoActive() && !!estateId;
    this.selectedEstateId.set(estateId);
    if (remember) this.communityScope.select(estateId || null);
    this.backToList(); this.messageText.set(''); this.draftFiles.set([]); this.showCompose.set(false);
    this.domoActive.set(keepDomo);
    this.loading.set(true); this.error.set('');
    await this.reloadConversations();
  }

  setFilter<K extends keyof InboxFilters>(key: K, value: InboxFilters[K]): void {
    this.filters.update(current => ({ ...current, [key]: value }));
  }

  clearFilters(): void { this.filters.set({ search: '', unreadOnly: false, range: null, sort: 'recent' }); }

  async reloadConversations(): Promise<void> {
    const request = ++this.listRequest;
    try {
      const rows = await this.data.listConversations(this.selectedEstateId() || undefined);
      if (request === this.listRequest && !this.destroyed) { this.conversations.set(rows); this.error.set(''); }
    } catch { if (request === this.listRequest) this.error.set('No se pudieron cargar las conversaciones. Vuelve a intentarlo.'); }
    finally { if (request === this.listRequest) this.loading.set(false); }
  }

  private async openFromQueryParam(): Promise<void> {
    const id = this.route.snapshot.queryParamMap.get('with');
    if (!id) return;
    const existing = this.conversations().find(c => c.otherUserId === id);
    if (existing) { await this.openConversation(existing); return; }
    try {
      const contact = (await this.data.listMessageContacts()).find(c => c.userId === id);
      if (contact) this.startConversationWith(contact);
    } catch { this.error.set('No se pudo abrir el contacto.'); }
  }

  private async poll(): Promise<void> {
    await this.reloadConversations();
    const id = this.activeConversationId();
    if (id && !this.sending()) await this.reloadMessages(id);
  }

  private async reloadMessages(id: string): Promise<boolean> {
    const request = ++this.threadRequest;
    try {
      const rows = await this.data.listConversationMessages(id);
      if (this.destroyed || this.activeConversationId() !== id || request !== this.threadRequest) return false;
      const changed = this.messages().at(-1)?.id !== rows.at(-1)?.id;
      this.messages.set(rows);
      if (changed) this.scrollToLatest();
      return true;
    } catch { if (this.activeConversationId() === id) this.error.set('No se pudieron cargar los mensajes.'); return false; }
  }

  async openDomo(): Promise<void> {
    if (!this.estates().length) { this.error.set('No hay comunidades disponibles para consultar a Domo.'); return; }
    if (!this.selectedEstateId()) await this.changeEstate(this.estates()[0].id, false);
    this.backToList(); this.showCompose.set(false); this.domoActive.set(true);
  }

  backToList(): void {
    this.threadRequest++;
    this.domoActive.set(false); this.pendingContact.set(null); this.activeConversationId.set(null);
    this.messages.set([]); this.showThreadMenu.set(false); this.threadLoading.set(false);
    this.resetMessageActions();
  }

  private resetMessageActions(): void {
    this.menuMessageId.set(null); this.confirmDeleteId.set(null); this.editingId.set(null); this.editText.set('');
  }

  async openConversation(conversation: ConversationSummary): Promise<void> {
    this.domoActive.set(false); this.showCompose.set(false); this.showThreadMenu.set(false);
    this.pendingContact.set(null); this.messages.set([]); this.activeConversationId.set(conversation.id);
    this.messageText.set(''); this.draftFiles.set([]); this.resetMessageActions(); this.threadLoading.set(true); this.error.set('');
    const loaded = await this.reloadMessages(conversation.id);
    if (this.activeConversationId() === conversation.id) this.threadLoading.set(false);
    if (loaded && conversation.unreadCount > 0) await this.markRead(conversation.id);
  }

  async markRead(id: string): Promise<void> {
    try {
      await this.data.markConversationRead(id);
      this.conversations.update(rows => rows.map(c => c.id === id ? { ...c, unreadCount: 0 } : c));
      this.state.bumpNotifications();
    } catch { this.error.set('No se pudo marcar la conversación como leída.'); }
    this.showThreadMenu.set(false);
  }

  askDeleteConversation(event: Event): void { event.stopPropagation(); this.confirmDeleteConversation.set(true); }

  async deleteConversation(id: string): Promise<void> {
    try {
      await this.data.deleteConversation(id);
      this.conversations.update(rows => rows.filter(c => c.id !== id));
      if (this.pinnedIds().includes(id)) this.togglePin(id);
      if (this.activeConversationId() === id) this.backToList();
      this.state.bumpNotifications();
    } catch { this.error.set('No se pudo eliminar la conversación. Vuelve a intentarlo.'); }
    this.showThreadMenu.set(false); this.confirmDeleteConversation.set(false);
  }

  isMine(message: DirectMessage): boolean { return message.senderId === this.userId; }
  senderName(message: DirectMessage): string { return this.isMine(message) ? this.userName : this.threadTitle(); }

  toggleMessageMenu(id: string, event: Event): void {
    event.stopPropagation();
    this.showThreadMenu.set(false); this.confirmDeleteId.set(null);
    this.menuMessageId.update(current => current === id ? null : id);
  }

  startEdit(message: DirectMessage): void {
    if (this.sending() || message.deletedAt || !this.isMine(message)) return;
    this.menuMessageId.set(null); this.confirmDeleteId.set(null);
    this.editText.set(message.text); this.editingId.set(message.id);
  }

  cancelEdit(): void { if (!this.savingEdit()) { this.editingId.set(null); this.editText.set(''); } }

  onEditKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.cancelEdit(); return; }
    if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey && !event.isComposing && event.keyCode !== 229) {
      event.preventDefault(); if (!event.repeat) void this.saveEdit();
    }
  }

  canSaveEdit(message: DirectMessage): boolean {
    const text = this.editText().trim();
    return !this.savingEdit() && text !== message.text && (!!text || !!message.attachments?.length);
  }

  async saveEdit(): Promise<void> {
    const id = this.editingId(); const original = this.messages().find(m => m.id === id);
    if (!id || !original || !this.canSaveEdit(original)) return;
    this.savingEdit.set(true); this.error.set('');
    try {
      const updated = await this.data.editDirectMessage(id, this.editText().trim());
      this.messages.update(rows => rows.map(m => m.id === id ? { ...m, text: updated.text, editedAt: updated.editedAt ?? new Date().toISOString() } : m));
      this.editingId.set(null); this.editText.set('');
    } catch { this.error.set('No se ha podido guardar el cambio. Vuelve a intentarlo.'); }
    finally { this.savingEdit.set(false); }
  }

  askDelete(id: string): void { this.confirmDeleteId.set(id); }

  async deleteMessage(id: string): Promise<void> {
    this.menuMessageId.set(null); this.confirmDeleteId.set(null); this.error.set('');
    try {
      const result = await this.data.deleteDirectMessage(id);
      const deletedAt = result.deletedAt ?? new Date().toISOString();
      this.messages.update(rows => rows.map(m => m.id === id ? { ...m, text: '', attachments: [], editedAt: null, deletedAt } : m));
      if (this.editingId() === id) this.cancelEdit();
      await this.reloadConversations();
    } catch { this.error.set('No se ha podido borrar el mensaje.'); }
  }

  setOverflow(id: string, overflows: boolean): void {
    this.overflowIds.update(ids => overflows ? (ids.includes(id) ? ids : [...ids, id]) : ids.filter(x => x !== id));
  }
  expandMessage(id: string): void { this.expandedIds.update(ids => ids.includes(id) ? ids : [...ids, id]); }

  openPicker(input: HTMLInputElement, accept: string): void { input.accept = accept; input.click(); }
  formatMessageTime(iso: string): string { return formatConversationDate(iso); }

  onComposerKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey && !event.isComposing && event.keyCode !== 229) {
      event.preventDefault(); if (!event.repeat) void this.sendMessage();
    }
  }

  selectFiles(event: Event): void {
    const input = event.target as HTMLInputElement;
    const selected = Array.from(input.files ?? []);
    const files = [...this.draftFiles()];
    this.error.set('');
    for (const file of selected) {
      if (files.length >= 5) { this.error.set('Puedes adjuntar hasta 5 archivos por mensaje.'); break; }
      if (!ALLOWED_TYPES.has(file.type) || !file.size || file.size > 10 * 1024 * 1024) {
        this.error.set('Usa imágenes, PDF o documentos admitidos de hasta 10 MB.'); continue;
      }
      if (!files.some(current => current.name === file.name && current.size === file.size && current.lastModified === file.lastModified)) files.push(file);
    }
    this.draftFiles.set(files); input.value = '';
  }

  removeFile(index: number): void { if (!this.sending()) this.draftFiles.update(files => files.filter((_, i) => i !== index)); }

  async sendMessage(): Promise<void> {
    const draft = this.messageText(); const text = draft.trim(); const files = this.draftFiles();
    const id = this.activeConversationId(); const pending = this.pendingContact();
    if ((!text && !files.length) || this.sending() || (!id && !pending)) return;
    const scope = this.selectedEstateId();
    this.sending.set(true); this.error.set('');
    try {
      const payload = id ? { conversationId: id, text } : { recipientUserId: pending!.userId, text };
      const sent = files.length ? await this.data.sendDirectMessageWithAttachments(payload, files) : await this.data.sendDirectMessage(payload);
      if (this.selectedEstateId() === scope && this.activeConversationId() === id && this.pendingContact() === pending) {
        if (this.messageText() === draft) this.messageText.set('');
        this.draftFiles.set([]); this.pendingContact.set(null); this.activeConversationId.set(sent.conversationId);
        await Promise.all([this.reloadConversations(), this.reloadMessages(sent.conversationId)]);
      }
    } catch { this.error.set('No se ha podido enviar el mensaje. El texto y los adjuntos siguen aquí para reintentarlo.'); }
    finally { this.sending.set(false); }
  }

  async downloadAttachment(attachment: DirectMessageAttachment): Promise<void> {
    if (this.downloadingIds().includes(attachment.id)) return;
    this.downloadingIds.update(ids => [...ids, attachment.id]);
    try {
      const blob = await this.data.downloadMessageAttachment(attachment.id);
      const url = URL.createObjectURL(blob); const link = document.createElement('a');
      link.href = url; link.download = attachment.name; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { this.error.set('No se ha podido descargar el adjunto.'); }
    finally { this.downloadingIds.update(ids => ids.filter(id => id !== attachment.id)); }
  }

  async openCompose(): Promise<void> {
    this.composeReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.composeSearch.set(''); this.showCompose.set(true);
    afterNextRender({ write: () => this.contactSearch()?.nativeElement.focus() }, { injector: this.injector });
    await this.loadContacts();
  }

  async loadContacts(): Promise<void> {
    const scope = this.selectedEstateId(); this.contactsLoading.set(true); this.contactsError.set(false);
    try {
      const contacts = await this.data.listMessageContacts(scope || undefined);
      if (scope === this.selectedEstateId()) this.contacts.set(contacts);
    } catch { this.contactsError.set(true); }
    finally { this.contactsLoading.set(false); }
  }

  closeCompose(): void { this.showCompose.set(false); this.composeReturnFocus?.focus(); }

  startConversationWith(contact: DirectMessageContact): void {
    this.domoActive.set(false); this.showCompose.set(false);
    const existing = this.conversations().find(c => c.otherUserId === contact.userId);
    if (existing) { void this.openConversation(existing); return; }
    // Si ya hubo conversación (la eliminó de su lista), se abre su historial ahora; seguirá fuera de la lista hasta que se envíe un mensaje.
    const previousId = contact.conversationId ?? null;
    this.pendingContact.set(contact); this.activeConversationId.set(previousId); this.messages.set([]);
    this.messageText.set(''); this.draftFiles.set([]); this.resetMessageActions(); this.error.set('');
    if (previousId) { this.threadLoading.set(true); void this.reloadMessages(previousId).finally(() => { if (this.activeConversationId() === previousId) this.threadLoading.set(false); }); }
  }

  togglePin(id: string): void {
    this.pinnedIds.update(ids => ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id]);
    try { localStorage.setItem(`domora.messages.pins.${this.userId}`, JSON.stringify(this.pinnedIds())); } catch { /* Preference still works in memory. */ }
    this.showThreadMenu.set(false);
  }

  private readPins(): string[] {
    try { const ids: unknown = JSON.parse(localStorage.getItem(`domora.messages.pins.${this.userId}`) ?? '[]'); return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string').slice(0, 500) : []; }
    catch { return []; }
  }

  toggleThreadMenu(event: Event): void { event.stopPropagation(); this.confirmDeleteConversation.set(false); this.menuMessageId.set(null); this.confirmDeleteId.set(null); this.showThreadMenu.update(open => !open); }
  @HostListener('document:click') closeThreadMenu(): void { this.showThreadMenu.set(false); this.confirmDeleteConversation.set(false); this.menuMessageId.set(null); this.confirmDeleteId.set(null); }
  @HostListener('document:keydown.escape') closeOverlays(): void {
    this.showThreadMenu.set(false); this.confirmDeleteConversation.set(false); this.menuMessageId.set(null); this.confirmDeleteId.set(null);
    if (this.showCompose()) this.closeCompose();
  }

  trapDialogTab(event: Event): void {
    if (!(event instanceof KeyboardEvent)) return;
    const focusable = Array.from((event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)'));
    const first = focusable[0]; const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }

  private scrollToLatest(): void {
    afterNextRender({ write: () => { const list = this.messageList()?.nativeElement; if (list) list.scrollTop = list.scrollHeight; } }, { injector: this.injector });
  }
}
