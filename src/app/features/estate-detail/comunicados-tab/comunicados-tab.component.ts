import { PageActionDirective } from '../../../shared/components/page-action/page-action.directive';
import { Component, Input, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SlicePipe } from '@angular/common';
import { BadgeComponent } from '../../../shared/components/badge/badge.component';
import { BtnComponent } from '../../../shared/components/btn/btn.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import {
  Communication, CommunicationCategory, CommunicationSignerRole, CommunicationReadReceipt, OwnerProperty,
} from '../../../core/models';
import { ComunicadosService } from '../../../core/comunicados.service';

import { SelectDropdownDirective } from '../../../shared/components/dropdown/select-dropdown.directive';
const COMMUNICATIONS_PAGE_SIZE = 30;

type CommunicationFilter = 'active' | 'archived' | 'all';

const CATEGORY_OPTIONS: CommunicationCategory[] = ['General', 'Urgente', 'Mercadillo', 'ObjetosPerdidos', 'Evento'];
const CATEGORY_LABELS: Record<CommunicationCategory, string> = {
  General: 'General',
  Urgente: 'Urgente',
  Mercadillo: 'Mercadillo vecinal',
  ObjetosPerdidos: 'Objetos perdidos',
  Evento: 'Evento',
};
const SIGNER_ROLE_OPTIONS: CommunicationSignerRole[] = ['secretario', 'presidente', 'administrador'];
const SIGNER_ROLE_LABELS: Record<CommunicationSignerRole, string> = {
  secretario: 'Secretario/a',
  presidente: 'Presidente/a',
  administrador: 'Administrador/a',
};

/**
 * Pestaña "Comunicados" del rol B — no existía antes: B solo tenía lectura
 * de comunicados vía otras pantallas, sin alta/edición/archivado propios.
 * Mismo patrón de extracción que `documentos-tab/`, `personal-tab/` y
 * `proveedores-tab/`: recibe solo `estateId` y se ocupa de su propia carga,
 * paginación y modales.
 *
 * A diferencia del rol C (que solo edita/elimina lo suyo), B administra
 * CUALQUIER comunicado — el servidor ya lo permite, así que aquí no hay
 * ningún chequeo de propiedad antes de editar/eliminar/archivar/moderar
 * respuestas.
 */
@Component({
  selector: 'app-comunicados-tab',
  standalone: true,
  imports: [PageActionDirective, BadgeComponent, BtnComponent, IconComponent, FormsModule, SlicePipe, SelectDropdownDirective],
  templateUrl: './comunicados-tab.component.html',
  styleUrl: './comunicados-tab.component.scss',
})
export class ComunicadosTabComponent implements OnInit {
  @Input({ required: true }) estateId!: string;
  /** Para el selector de destinatario dirigido — mismo patrón que documentos-tab. */
  @Input({ required: true }) properties: OwnerProperty[] = [];
  @Input() titularByProperty: Record<string, string> = {};

  private data = inject(ComunicadosService);

  filter = signal<CommunicationFilter>('active');
  communications = signal<Communication[]>([]);
  /** Total en servidor: puede ser mayor que `communications().length` (lista paginada). */
  communicationsTotal = signal(0);
  communicationsPage = signal(1);
  communicationsLoadingMore = signal(false);
  hasMoreCommunications = computed(() => this.communications().length < this.communicationsTotal());
  loading = signal(true);
  toastMessage = signal<string | null>(null);

  categoryOptions = CATEGORY_OPTIONS;
  signerRoleOptions = SIGNER_ROLE_OPTIONS;

  categoryLabel(cat: CommunicationCategory): string {
    return CATEGORY_LABELS[cat];
  }

  signerRoleLabel(role: CommunicationSignerRole): string {
    return SIGNER_ROLE_LABELS[role];
  }

  locationLabel(p: OwnerProperty): string {
    const parts: string[] = [];
    if (p.floor) parts.push(`${p.floor}ª planta`);
    if (p.door) parts.push(`Puerta ${p.door}`);
    if (p.staircase) parts.push(`Esc. ${p.staircase}`);
    return parts.join(', ') || (p.ref ?? '—');
  }

  propertyOptionLabel(p: OwnerProperty): string {
    const titular = this.titularByProperty[p.id];
    return titular ? `${this.locationLabel(p)} · ${titular}` : this.locationLabel(p);
  }

  communicationTargetLabel(comm: Communication): string {
    if (!comm.targetPropertyId) return 'Toda la finca';
    const p = this.properties.find(x => x.id === comm.targetPropertyId);
    return p ? this.propertyOptionLabel(p) : 'Propietario específico';
  }

  showNuevoComunicado = signal(false);
  /** null = alta; con valor = edición de un comunicado existente (de cualquier autor). */
  editCommId = signal<string | null>(null);
  ncTitle = signal('');
  ncBody = signal('');
  ncActiveUntil = signal('');
  ncCategory = signal<CommunicationCategory>('General');
  ncTargetProperty = signal<'all' | string>('all');
  ncIsLegalNotice = signal(false);
  ncLegalNoticeSignerRole = signal<CommunicationSignerRole>('secretario');
  ncLegalNoticeSignerName = signal('');
  ncLegalNoticeReason = signal('');
  ncLegalNoticeCountersigned = signal(false);
  ncErrors = signal<{ title?: boolean; body?: boolean }>({});
  ncSaving = signal(false);
  ncError = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  private async reload(): Promise<void> {
    this.loading.set(true);
    try {
      const page = await this.data.listCommunicationsByEstate(this.estateId, {
        page: 1,
        pageSize: COMMUNICATIONS_PAGE_SIZE,
        filter: this.filter(),
      });
      this.communications.set(page.items);
      this.communicationsTotal.set(page.total);
      this.communicationsPage.set(page.page);
    } catch (error) {
      console.error('Error cargando los comunicados', error);
    } finally {
      this.loading.set(false);
    }
  }

  async setFilter(filter: CommunicationFilter): Promise<void> {
    if (this.filter() === filter) return;
    this.filter.set(filter);
    await this.reload();
  }

  /** Carga la siguiente página y la añade a la lista, sin recargar lo ya mostrado. */
  async loadMoreCommunications(): Promise<void> {
    if (this.communicationsLoadingMore() || !this.hasMoreCommunications()) return;
    this.communicationsLoadingMore.set(true);
    try {
      const next = this.communicationsPage() + 1;
      const page = await this.data.listCommunicationsByEstate(this.estateId, {
        page: next,
        pageSize: COMMUNICATIONS_PAGE_SIZE,
        filter: this.filter(),
      });
      this.communications.set([...this.communications(), ...page.items]);
      this.communicationsTotal.set(page.total);
      this.communicationsPage.set(page.page);
    } catch (error) {
      console.error('Error cargando más comunicados', error);
      this.showToast('No se pudieron cargar más comunicados');
    } finally {
      this.communicationsLoadingMore.set(false);
    }
  }

  private showToast(msg: string): void {
    this.toastMessage.set(msg);
    setTimeout(() => this.toastMessage.set(null), 2500);
  }

  /** "Editado por X el Y" — solo cuando quien editó por última vez no es el autor original. */
  showsEditTrace(comm: Communication): boolean {
    return !!comm.lastEditedByUserId && comm.lastEditedByUserId !== comm.authorUserId;
  }

  openNuevoComunicado(): void {
    this.editCommId.set(null);
    this.ncTitle.set('');
    this.ncBody.set('');
    this.ncActiveUntil.set('');
    this.ncCategory.set('General');
    this.ncTargetProperty.set('all');
    this.ncIsLegalNotice.set(false);
    this.ncLegalNoticeSignerRole.set('secretario');
    this.ncLegalNoticeSignerName.set('');
    this.ncLegalNoticeReason.set('');
    this.ncLegalNoticeCountersigned.set(false);
    this.ncErrors.set({});
    this.ncError.set(null);
    this.showNuevoComunicado.set(true);
  }

  /** Sin chequeo de propiedad: B puede editar cualquier comunicado, el servidor ya lo garantiza. */
  openEdit(comm: Communication): void {
    this.editCommId.set(comm.id);
    this.ncTitle.set(comm.title);
    this.ncBody.set(comm.body);
    this.ncActiveUntil.set(comm.activeUntil ? comm.activeUntil.slice(0, 10) : '');
    this.ncCategory.set(comm.category);
    this.ncTargetProperty.set(comm.targetPropertyId ?? 'all');
    this.ncIsLegalNotice.set(comm.isLegalNotice);
    this.ncLegalNoticeSignerRole.set(comm.legalNoticeSignerRole ?? 'secretario');
    this.ncLegalNoticeSignerName.set(comm.legalNoticeSignerName ?? '');
    this.ncLegalNoticeReason.set(comm.legalNoticeReason ?? '');
    this.ncLegalNoticeCountersigned.set(comm.legalNoticeCountersignedByPresident ?? false);
    this.ncErrors.set({});
    this.ncError.set(null);
    this.showNuevoComunicado.set(true);
  }

  closeNuevoComunicado(): void {
    this.showNuevoComunicado.set(false);
  }

  async submitComunicado(): Promise<void> {
    const title = this.ncTitle().trim();
    const body = this.ncBody().trim();
    const errors: { title?: boolean; body?: boolean } = {};
    if (!title) errors.title = true;
    if (!body) errors.body = true;
    if (errors.title || errors.body) {
      this.ncErrors.set(errors);
      return;
    }
    this.ncSaving.set(true);
    this.ncError.set(null);
    try {
      const activeUntil = this.ncActiveUntil().trim() || undefined;
      const targetPropertyId = this.ncTargetProperty() === 'all' ? undefined : this.ncTargetProperty();
      const isLegalNotice = this.ncIsLegalNotice();
      const editId = this.editCommId();
      const payload = {
        title, body, activeUntil,
        category: this.ncCategory(),
        targetPropertyId,
        isLegalNotice,
        ...(isLegalNotice && {
          legalNoticeSignerRole: this.ncLegalNoticeSignerRole(),
          legalNoticeSignerName: this.ncLegalNoticeSignerName().trim() || undefined,
          legalNoticeReason: this.ncLegalNoticeReason().trim() || undefined,
          legalNoticeCountersignedByPresident: this.ncLegalNoticeCountersigned(),
        }),
      };
      if (editId) {
        await this.data.updateCommunication(editId, { ...payload, activeUntil: activeUntil ?? null, targetPropertyId: targetPropertyId ?? null });
      } else {
        await this.data.createCommunication(this.estateId, payload);
      }
      this.showNuevoComunicado.set(false);
      await this.reload();
      this.showToast(editId ? 'Comunicado actualizado correctamente' : 'Comunicado publicado correctamente');
    } catch (error: any) {
      console.error('Error guardando el comunicado', error);
      const msg = error?.error?.message;
      this.ncError.set(typeof msg === 'string' ? msg : 'No se pudo guardar el comunicado');
    } finally {
      this.ncSaving.set(false);
    }
  }

  async remove(comm: Communication): Promise<void> {
    if (!confirm(`¿Eliminar el comunicado "${comm.title}"? Esta acción no se puede deshacer.`)) return;
    try {
      await this.data.deleteCommunication(comm.id);
      this.communications.set(this.communications().filter(c => c.id !== comm.id));
      this.communicationsTotal.set(Math.max(0, this.communicationsTotal() - 1));
      this.showToast('Comunicado eliminado');
    } catch (error) {
      console.error('Error eliminando el comunicado', error);
      this.showToast('No se pudo eliminar el comunicado');
    }
  }

  /** Toggle reversible — sin confirmación, a diferencia de eliminar. */
  async toggleArchived(comm: Communication): Promise<void> {
    const wasArchived = comm.archived;
    try {
      await this.data.setCommunicationArchived(comm.id, !wasArchived);
      await this.reload();
      this.showToast(wasArchived ? 'Comunicado desarchivado' : 'Comunicado archivado');
    } catch (error) {
      console.error('Error archivando el comunicado', error);
      this.showToast('No se pudo archivar el comunicado');
    }
  }

  /** Toggle reversible — un post refijado más tarde vuelve a subir en el orden. */
  async togglePinned(comm: Communication): Promise<void> {
    const wasPinned = !!comm.pinnedAt;
    try {
      await this.data.setCommunicationPinned(comm.id, !wasPinned);
      await this.reload();
      this.showToast(wasPinned ? 'Comunicado desfijado' : 'Comunicado fijado arriba');
    } catch (error) {
      console.error('Error fijando el comunicado', error);
      this.showToast('No se pudo fijar el comunicado');
    }
  }

  // ── Respuestas — B modera cualquiera, sin chequeo de propiedad. ─────────
  replyDrafts = signal<Record<string, string>>({});

  replyDraft(commId: string): string {
    return this.replyDrafts()[commId] ?? '';
  }

  setReplyDraft(commId: string, value: string): void {
    this.replyDrafts.set({ ...this.replyDrafts(), [commId]: value });
  }

  async submitReply(comm: Communication): Promise<void> {
    const text = this.replyDraft(comm.id).trim();
    if (!text) return;
    try {
      await this.data.addCommunicationReply(comm.id, text);
      this.setReplyDraft(comm.id, '');
      await this.reload();
    } catch (error) {
      console.error('Error respondiendo al comunicado', error);
      this.showToast('No se pudo enviar la respuesta');
    }
  }

  async deleteReply(comm: Communication, replyId: string): Promise<void> {
    if (!confirm('¿Eliminar esta respuesta?')) return;
    try {
      await this.data.deleteCommunicationReply(comm.id, replyId);
      await this.reload();
    } catch (error) {
      console.error('Error eliminando la respuesta', error);
      this.showToast('No se pudo eliminar la respuesta');
    }
  }

  // ── Lecturas — quién de los vecinos ya lo vio. ───────────────────────────
  showReadsFor = signal<string | null>(null);
  reads = signal<CommunicationReadReceipt[]>([]);
  readsLoading = signal(false);

  async openReads(comm: Communication): Promise<void> {
    this.showReadsFor.set(comm.id);
    this.readsLoading.set(true);
    try {
      this.reads.set(await this.data.listCommunicationReads(comm.id));
    } catch (error) {
      console.error('Error cargando las lecturas', error);
      this.showToast('No se pudieron cargar las lecturas');
    } finally {
      this.readsLoading.set(false);
    }
  }

  closeReads(): void {
    this.showReadsFor.set(null);
    this.reads.set([]);
  }
}
