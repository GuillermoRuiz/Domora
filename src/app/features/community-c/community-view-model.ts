import { Injectable, inject, signal } from '@angular/core';
import { AuthService } from '../../core/auth.service';
import { ReceiptsService } from '../../core/receipts.service';
import type { AccountingReceipt, ActivityItem, Document as AppDocument } from '../../core/models';
import { OwnerCommunityService } from '../../core/owner-community.service';
import type { CommunitySummary, PropertyEvent, PropertyOverview } from '../../core/owner-community.models';
import { ComunicadosService } from '../../core/comunicados.service';
import { MeetingsService } from '../../core/meetings.service';
import { ResourceReadsService } from '../../core/resource-reads.service';
import type { ScopeProperty } from '../../core/owner-scope.service';

/** Cuántas actividades se piden: el feed mezcla todas las fincas del usuario y luego se filtra. */
const ACTIVITY_FETCH = 40;
/** Documentos que se piden: se filtran por propiedad y luego se enseñan los más recientes. */
const DOCUMENTS_FETCH = 12;
/** Eventos que se enseñan al unir los de varias propiedades (el servidor da hasta 10 por propiedad). */
const EVENTS_LIMIT = 10;
/** Clave de «Todas mis propiedades» para descartar respuestas tardías. */
const ALL = '__all__';

/**
 * Los datos de «Mi comunidad» de la propiedad que se está viendo. Se provee a
 * nivel de página (no es global): vive lo que vive la pantalla. Cada bloque
 * del panel lee de aquí; al cambiar de propiedad se vuelve a pedir todo y una
 * respuesta tardía de la propiedad anterior se descarta.
 */
@Injectable()
export class CommunityViewModel {
  private api = inject(OwnerCommunityService);
  private receiptsApi = inject(ReceiptsService);
  private auth = inject(AuthService);
  private resourceReads = inject(ResourceReadsService);
  private comunicados = inject(ComunicadosService);
  private meetingsApi = inject(MeetingsService);

  /** Propiedad (o «Todas») cuyos datos se están mostrando (para descartar respuestas tardías de otra). */
  private current: string | null = null;

  readonly overview = signal<PropertyOverview | null>(null);
  readonly overviewFailed = signal(false);
  readonly summary = signal<CommunitySummary | null>(null);
  readonly summaryFailed = signal(false);
  /** Recibos de la propiedad (sin anular), del periodo más reciente al más antiguo; null mientras cargan. */
  readonly receipts = signal<AccountingReceipt[] | null>(null);
  readonly receiptsFailed = signal(false);
  /** Lo próximo que afecta a la propiedad (juntas, vencimientos, reservas y revisiones). */
  readonly events = signal<PropertyEvent[] | null>(null);
  readonly eventsFailed = signal(false);
  /** Actividad reciente de la finca (la del usuario en ella), lo más nuevo primero. */
  readonly activity = signal<ActivityItem[] | null>(null);
  readonly activityFailed = signal(false);
  /** Documentos de la comunidad que este propietario puede ver, el más reciente primero. */
  readonly documents = signal<AppDocument[] | null>(null);
  readonly documentsFailed = signal(false);
  /** La última junta celebrada que ya tiene acta firmada, o null si no hay ninguna. */
  readonly lastActaMeetingId = signal<string | null>(null);

  /** Pide los datos de una propiedad y de su finca (si la tiene); null vacía la pantalla. `estatePropertyIds` son las propiedades del usuario en esa finca (para filtrar su actividad). */
  load(propertyId: string | null, estateId: string | null = null, estatePropertyIds: string[] = []): void {
    this.current = propertyId;
    this.overview.set(null);
    this.overviewFailed.set(false);
    this.summary.set(null);
    this.summaryFailed.set(false);
    this.receipts.set(null);
    this.receiptsFailed.set(false);
    this.events.set(null);
    this.eventsFailed.set(false);
    this.activity.set(null);
    this.activityFailed.set(false);
    this.documents.set(null);
    this.documentsFailed.set(false);
    this.lastActaMeetingId.set(null);
    if (!propertyId) return;
    void this.loadOverview(propertyId);
    void this.loadReceiptsOf(propertyId, new Set([propertyId]));
    void this.loadEvents(propertyId);
    if (estateId) {
      void this.loadDocuments(propertyId, estateId);
      void this.loadLastActa(propertyId, estateId);
    }
    void this.loadActivity(propertyId, estatePropertyIds.length > 0 ? estatePropertyIds : [propertyId]);
    if (estateId) void this.loadSummary(propertyId, estateId);
  }

  /**
   * «Todas mis propiedades»: fichas agregadas por el servidor y, del resto, lo de
   * cada propiedad unido sin repetir (una junta o un documento de una finca con
   * varias propiedades del usuario sale una vez). Sin resumen de una finca: la
   * pantalla lista las comunidades.
   */
  loadAll(properties: ScopeProperty[]): void {
    this.load(null);
    this.current = ALL;
    const ids = properties.map(p => p.id);
    const estateIds = [...new Set(properties.flatMap(p => (p.estateId ? [p.estateId] : [])))];
    void this.loadAllOverview();
    void this.loadReceiptsOf(ALL, new Set(ids));
    void this.loadAllEvents(properties);
    void this.loadActivity(ALL, ids);
    void this.loadAllDocuments(estateIds, new Set(ids));
    // El acta de «la última junta» solo es inequívoca si todas están en una misma finca.
    if (estateIds.length === 1) void this.loadLastActa(ALL, estateIds[0]);
  }

  private async loadAllOverview(): Promise<void> {
    try {
      const overview = await this.api.getOwnerOverview();
      if (this.current === ALL) this.overview.set(overview);
    } catch (error) {
      console.error('Error cargando las fichas de «Todas mis propiedades»', error);
      if (this.current === ALL) this.overviewFailed.set(true);
    }
  }

  private async loadAllEvents(properties: ScopeProperty[]): Promise<void> {
    try {
      const lists = await Promise.all(properties.map(p => this.api.getPropertyEvents(p.id)));
      if (this.current !== ALL) return;
      // With several estates each event says which community it belongs to (two meetings on one day must not look alike).
      const severalEstates = new Set(properties.map(p => p.estateId)).size > 1;
      const labelled = lists.flatMap((events, i) => {
        const estate = properties[i].estateName;
        return severalEstates && estate ? events.map(e => ({ ...e, subtitle: e.subtitle ? `${estate} · ${e.subtitle}` : estate })) : events;
      });
      const unique = new Map(labelled.map(e => [e.id, e]));
      this.events.set(
        [...unique.values()]
          .sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? ''))
          .slice(0, EVENTS_LIMIT),
      );
    } catch (error) {
      console.error('Error cargando los próximos eventos', error);
      if (this.current === ALL) this.eventsFailed.set(true);
    }
  }

  private async loadAllDocuments(estateIds: string[], mine: Set<string>): Promise<void> {
    try {
      const pages = await Promise.all(estateIds.map(id => this.comunicados.listDocumentsByEstate(id, { pageSize: DOCUMENTS_FETCH })));
      if (this.current !== ALL) return;
      const unique = new Map(
        pages.flatMap(page => page.items).filter(d => !d.targetPropertyId || mine.has(d.targetPropertyId)).map(d => [d.id, d]),
      );
      this.documents.set([...unique.values()].sort((a, b) => b.date.localeCompare(a.date)));
    } catch (error) {
      console.error('Error cargando los documentos recientes', error);
      if (this.current === ALL) this.documentsFailed.set(true);
    }
  }

  private async loadOverview(propertyId: string): Promise<void> {
    try {
      const overview = await this.api.getPropertyOverview(propertyId);
      if (this.current === propertyId) this.overview.set(overview);
    } catch (error) {
      console.error('Error cargando las fichas de «Mi comunidad»', error);
      if (this.current === propertyId) this.overviewFailed.set(true);
    }
  }

  private async loadSummary(propertyId: string, estateId: string): Promise<void> {
    try {
      const summary = await this.api.getCommunitySummary(estateId);
      if (this.current === propertyId) this.summary.set(summary);
    } catch (error) {
      console.error('Error cargando el resumen de la comunidad', error);
      if (this.current === propertyId) this.summaryFailed.set(true);
    }
  }

  private async loadReceiptsOf(key: string, propertyIds: Set<string>): Promise<void> {
    const userId = this.auth.currentUser()?.id;
    if (!userId) return;
    try {
      // El servidor devuelve los recibos de todas las propiedades del usuario; aquí solo cuentan las que se ven.
      const all = await this.receiptsApi.listReceiptsForUser(userId);
      if (this.current !== key) return;
      this.receipts.set(
        all
          .filter(r => !!r.propertyId && propertyIds.has(r.propertyId) && r.status !== 'Anulado')
          .sort((a, b) => b.periodKey.localeCompare(a.periodKey) || b.no.localeCompare(a.no)), // por periodo: `date` es la fecha de cobro
      );
    } catch (error) {
      console.error('Error cargando los recibos de «Mi comunidad»', error);
      if (this.current === key) this.receiptsFailed.set(true);
    }
  }

  private async loadEvents(propertyId: string): Promise<void> {
    try {
      const events = await this.api.getPropertyEvents(propertyId);
      if (this.current === propertyId) this.events.set(events);
    } catch (error) {
      console.error('Error cargando los próximos eventos', error);
      if (this.current === propertyId) this.eventsFailed.set(true);
    }
  }

  private async loadActivity(propertyId: string, estatePropertyIds: string[]): Promise<void> {
    try {
      // El feed es del usuario en TODAS sus fincas: se pide más y se queda solo con lo de esta finca
      // (y con lo que no trae propiedad: comunicados y documentos de comunidad).
      const feed = await this.resourceReads.listActivityForUser(undefined, ACTIVITY_FETCH);
      if (this.current !== propertyId) return;
      const mine = new Set(estatePropertyIds);
      this.activity.set(feed.filter(item => !item.propertyId || mine.has(item.propertyId)));
    } catch (error) {
      console.error('Error cargando la actividad reciente', error);
      if (this.current === propertyId) this.activityFailed.set(true);
    }
  }

  private async loadDocuments(propertyId: string, estateId: string): Promise<void> {
    try {
      // El servidor ya deja fuera lo dirigido a otros vecinos; aquí además solo lo general o dirigido a ESTA propiedad.
      const page = await this.comunicados.listDocumentsByEstate(estateId, { pageSize: DOCUMENTS_FETCH });
      if (this.current !== propertyId) return;
      this.documents.set(page.items.filter(d => !d.targetPropertyId || d.targetPropertyId === propertyId));
    } catch (error) {
      console.error('Error cargando los documentos recientes', error);
      if (this.current === propertyId) this.documentsFailed.set(true);
    }
  }

  private async loadLastActa(propertyId: string, estateId: string): Promise<void> {
    try {
      const meetings = await this.meetingsApi.listMeetingsByEstate(estateId);
      if (this.current !== propertyId) return;
      const withActa = meetings
        .filter(m => m.status === 'firmada' && !!m.actaS3Key)
        .sort((a, b) => b.scheduledAt1.localeCompare(a.scheduledAt1));
      this.lastActaMeetingId.set(withActa[0]?.id ?? null);
    } catch (error) {
      // Sin acta disponible: el acceso rápido queda desactivado, no es un error que enseñar.
      console.error('Error buscando la última acta', error);
    }
  }
}
