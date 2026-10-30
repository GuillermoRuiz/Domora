import { Component, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import type { ActivityItem, Document as AppDocument } from '../../core/models';
import { saveBlob } from '../../core/file-download';
import { MeetingsService } from '../../core/meetings.service';
import { ResourceReadsService } from '../../core/resource-reads.service';
import { OwnerScopeService } from '../../core/owner-scope.service';
import { OWNER_DOCUMENTS_ROUTE, OWNER_ISSUES_ROUTE, ownerDocumentQueryParams, ownerIssueQueryParams } from '../../core/legacy-owner-tab-redirect';
import { StateService } from '../../core/state.service';
import { TopbarComponent } from '../../layout/topbar/topbar.component';
import { BtnComponent } from '../../shared/components/btn/btn.component';
import { SectionCardComponent } from '../../shared/components/section-card/section-card.component';
import { TransferInstructionsModalComponent } from '../../shared/components/transfer-instructions-modal/transfer-instructions-modal.component';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { CommunityKpisComponent, type KpiTarget } from './community-kpis/community-kpis.component';
import { CommunityActivityComponent } from './community-activity/community-activity.component';
import { CommunityDocumentsComponent } from './community-documents/community-documents.component';
import { CommunityQuickActionsComponent, type QuickAction } from './community-quick-actions/community-quick-actions.component';
import { CommunityEventsComponent, type EventSection } from './community-events/community-events.component';
import { CommunityReceiptsComponent, type PaymentRequest } from './community-receipts/community-receipts.component';
import { CommunityScopeSelectorComponent } from './community-scope-selector/community-scope-selector.component';
import { CommunitySummaryComponent } from './community-summary/community-summary.component';
import { CommunityViewModel } from './community-view-model';

/**
 * «Mi comunidad»: el inicio del propietario. Muestra la propiedad elegida en la
 * cabecera y, de ella, su finca; con varias, también «Todas mis propiedades»
 * (como «Todas mis comunidades» de la gestora). Sustituye a «Mis
 * propiedades»; si el usuario aún no tiene ninguna, desde aquí la añade o
 * solicita su vinculación.
 */
@Component({
  selector: 'app-community-c',
  standalone: true,
  imports: [TopbarComponent, BtnComponent, SectionCardComponent, IconComponent, CommunityScopeSelectorComponent, CommunityKpisComponent, CommunitySummaryComponent, CommunityReceiptsComponent, TransferInstructionsModalComponent, CommunityActivityComponent, CommunityEventsComponent, CommunityDocumentsComponent, CommunityQuickActionsComponent],
  providers: [CommunityViewModel],
  templateUrl: './community-c.component.html',
  styleUrl: './community-c.component.scss',
})
export class CommunityCComponent {
  readonly scope = inject(OwnerScopeService);
  readonly vm = inject(CommunityViewModel);
  private state = inject(StateService);
  private router = inject(Router);
  private resourceReads = inject(ResourceReadsService);
  private meetings = inject(MeetingsService);

  constructor() {
    // Recarga en el alta inicial y cada vez que se crea o borra una propiedad
    // (el modal de alta vive en la raíz de la app y avisa con esta versión).
    effect(() => {
      this.state.propertiesVersion();
      void this.scope.load();
    });
    // Al cambiar de propiedad, o pasar a «Todas» (o cargarla por primera vez), se piden sus datos.
    effect(() => {
      const all = this.scope.isAll();
      const selected = this.scope.selected();
      const items = this.scope.items();
      untracked(() => {
        if (all) {
          this.vm.loadAll(items);
          return;
        }
        const propertyId = selected?.id ?? null;
        const estateId = selected?.estateId ?? null;
        const siblings = estateId ? items.filter(p => p.estateId === estateId).map(p => p.id) : [];
        this.vm.load(propertyId, estateId, siblings);
      });
    });
  }

  private readonly selector = viewChild(CommunityScopeSelectorComponent);

  /** Nombre de cada propiedad, para la tarjeta de recibos en «Todas». */
  readonly propertyNames = computed(() => Object.fromEntries(this.scope.items().map(p => [p.id, p.nickname])));

  /** «Todas»: las comunidades del propietario, en lugar del resumen de una finca. */
  readonly communities = computed(() =>
    this.scope.groups().map(g => ({
      key: g.estateId ?? 'none',
      name: g.estateName,
      address: g.properties[0]?.addressFull ?? '',
      count: g.properties.length,
      firstPropertyId: g.properties[0]?.id ?? null,
    })),
  );

  /** Elegir una comunidad de la lista pasa a ver su primera propiedad. */
  openCommunity(propertyId: string | null): void {
    if (propertyId) this.scope.select(propertyId);
  }

  /**
   * Cada ficha lleva a su sección de la propiedad que se está viendo. En «Todas»,
   * si la sección no es de una propiedad concreta, se abre el selector para elegirla.
   */
  openSection(section: KpiTarget | EventSection, propertyId = this.scope.selected()?.id ?? null): void {
    if (propertyId) void this.router.navigate(['/c/properties', propertyId], { queryParams: { tab: section } });
    else if (this.scope.isAll()) this.selector()?.openPanel();
  }

  /** La comunidad en la que se está, para abrir Incidencias ya acotada a ella (en «Todas» no se acota). */
  private issuesScope(): { estateId?: string } {
    const estateId = this.scope.selected()?.estateId;
    return this.scope.isAll() || !estateId ? {} : { estateId };
  }

  /** En «Todas», el próximo recibo y la próxima junta saben de qué propiedad (o finca) son. */
  openKpi(target: KpiTarget): void {
    // Incidencias y documentos tienen su propio módulo: no hace falta ninguna propiedad. Las incidencias se
    // acotan a la comunidad en la que se está.
    if (target === 'issues') return void this.router.navigate([OWNER_ISSUES_ROUTE], { queryParams: this.issuesScope() });
    if (target === 'documents') return void this.router.navigate([OWNER_DOCUMENTS_ROUTE], { queryParams: { onlyNew: '1' } });
    const overview = this.vm.overview();
    if (this.scope.isAll() && target === 'receipts') return this.openSection(target, overview?.nextReceipt?.propertyId ?? null);
    if (this.scope.isAll() && target === 'juntas') {
      const estateId = overview?.nextMeeting?.estateId;
      return this.openSection(target, this.scope.items().find(p => !!estateId && p.estateId === estateId)?.id ?? null);
    }
    this.openSection(target);
  }

  /** Un evento lleva a su sección de la propiedad; las revisiones de instalaciones no tienen pantalla propia. */
  openEvent(target: EventSection): void {
    this.openSection(target);
  }

  /** «Ver todas» de la actividad. */
  openActivityFeed(): void {
    void this.router.navigate(['/c/activity']);
  }

  /** Una incidencia o un documento se abren en su página; un recibo, en la pestaña de la propiedad. */
  openActivityItem(item: ActivityItem): void {
    if (item.type === 'incidencia') {
      void this.router.navigate([OWNER_ISSUES_ROUTE], { queryParams: ownerIssueQueryParams(item.id) });
      return;
    }
    if (item.type === 'documento') {
      void this.router.navigate([OWNER_DOCUMENTS_ROUTE], { queryParams: ownerDocumentQueryParams(item.id) });
      return;
    }
    void this.router.navigate(['/c/properties', item.propertyId], { queryParams: { tab: 'receipts' } });
  }

  /** Aviso de una descarga que ha fallado (se quita al cambiar de propiedad o al volver a intentarlo). */
  readonly actionError = signal<string | null>(null);

  async downloadDocument(doc: AppDocument): Promise<void> {
    this.actionError.set(null);
    try {
      await saveBlob(await this.resourceReads.downloadDocumentFile(doc.id), doc.title);
    } catch (error) {
      console.error('Error descargando el documento', error);
      this.actionError.set(`No se pudo descargar "${doc.title}". Inténtalo de nuevo.`);
    }
  }

  /** Los atajos de «Accesos rápidos». */
  async runQuickAction(action: QuickAction): Promise<void> {
    switch (action) {
      case 'issue':
        // Reportar una incidencia abre el módulo de Incidencias de la comunidad en la que se está (en «Todas» se elige allí).
        void this.router.navigate([OWNER_ISSUES_ROUTE], { queryParams: { new: '1', ...this.issuesScope() } });
        break;
      case 'message':
        void this.router.navigate(['/c/messages']);
        break;
      case 'receipts':
        this.openSection('receipts');
        break;
      case 'acta': {
        const meetingId = this.vm.lastActaMeetingId();
        if (!meetingId) break;
        this.actionError.set(null);
        try {
          await saveBlob(await this.meetings.downloadActa(meetingId), 'Acta de la última junta');
        } catch (error) {
          console.error('Error descargando el acta', error);
          this.actionError.set('No se pudo descargar el acta. Inténtalo de nuevo.');
        }
        break;
      }
    }
  }

  /** «Ver todos» de los documentos: la página de Documentación (con el mismo selector, no necesita propiedad). */
  openDocuments(): void {
    void this.router.navigate([OWNER_DOCUMENTS_ROUTE]);
  }

  /** Un documento reciente se abre en la página de Documentación. */
  openDocument(doc: AppDocument): void {
    void this.router.navigate([OWNER_DOCUMENTS_ROUTE], { queryParams: { doc: doc.id } });
  }

  /** «Ver detalles»: la ficha completa de la propiedad elegida. */
  openPropertyDetails(): void {
    const propertyId = this.scope.selected()?.id;
    if (propertyId) void this.router.navigate(['/c/properties', propertyId]);
  }

  /** Pago en curso: el modal de instrucciones de transferencia. */
  readonly paying = signal<PaymentRequest | null>(null);
  /** La propiedad del pago (en «Todas», la del recibo): su finca da el IBAN y el nombre. */
  readonly payingProperty = computed(() => {
    const id = this.paying()?.propertyId;
    return (id && this.scope.items().find(p => p.id === id)) || this.scope.selected();
  });

  openAddProperty(): void {
    this.state.showAddPropertyModal.set(true);
  }
}
