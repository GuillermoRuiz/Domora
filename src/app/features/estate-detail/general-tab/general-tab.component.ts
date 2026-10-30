import { Component, EventEmitter, Input, OnChanges, Output, computed, inject, input, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import type { Estate } from '../../../core/models';
import { EstateGeneralService, type EstateGeneralOverview } from '../../../core/estate-general.service';
import { ResourceReadsService } from '../../../core/resource-reads.service';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { SepaTabComponent } from '../sepa-tab/sepa-tab.component';
import { EstateMapComponent } from './estate-map/estate-map.component';

const EURO = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', useGrouping: 'always' } as unknown as Intl.NumberFormatOptions);
const AREA = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2, useGrouping: 'always' } as unknown as Intl.NumberFormatOptions);
const QUOTA = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const DAY = new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
const SHORT_DAY = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const ESTATE_TYPE_LABEL: Record<string, string> = { Edificio: 'Edificio de viviendas', Urbanizacion: 'Urbanización', Urbanización: 'Urbanización' };

export type GeneralCardId =
  | 'community' | 'address' | 'contacts' | 'fiscal' | 'bank' | 'documents'
  | 'offices' | 'administrator' | 'cadastral' | 'coefficients' | 'insurance' | 'notes';

export interface GeneralField { label: string; value: string | null }

const day = (iso: string | null | undefined) => (iso ? DAY.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`)) : null);
const area = (m2: number | null | undefined) => (m2 == null ? null : `${AREA.format(m2)} m²`);
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('');
/** Accent- and case-insensitive text for the search box. */
const fold = (text: string) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/**
 * Pestaña «Datos generales» (rol B): ficha de SOLO LECTURA de la finca en
 * tarjetas por tema. Cada dato se mantiene en su módulo (Editar finca,
 * Propiedades, Contratos, Documentos, Contabilidad); aquí solo se consulta.
 * El buscador filtra las tarjetas por su texto, en el navegador.
 */
@Component({
  selector: 'app-general-tab',
  standalone: true,
  imports: [NgTemplateOutlet, IconComponent, SepaTabComponent, EstateMapComponent],
  templateUrl: './general-tab.component.html',
  styleUrl: './general-tab.component.scss',
})
export class GeneralTabComponent implements OnChanges {
  readonly estate = input.required<Estate>();
  @Input({ required: true }) estateId!: string;
  /** Se guardó el acreedor SEPA: el padre refresca la puesta en marcha. */
  @Output() sepaSaved = new EventEmitter<void>();
  /** «Ver historial de cargos»: lo abre el padre (mismo diálogo que el menú «Acciones»). */
  @Output() officeHistory = new EventEmitter<void>();
  /** «Ver todos los documentos»: el padre abre la pestaña Documentos (la biblioteca). */
  @Output() openDocuments = new EventEmitter<void>();

  private readonly general = inject(EstateGeneralService);
  private readonly reads = inject(ResourceReadsService);

  /** null = loading. */
  readonly overview = signal<EstateGeneralOverview | null>(null);
  readonly loadError = signal(false);
  readonly search = signal('');
  readonly copied = signal(false);
  private version = 0;

  readonly initials = initials;
  readonly day = day;

  ngOnChanges(): void {
    void this.load();
  }

  async load(): Promise<void> {
    const version = ++this.version;
    this.loadError.set(false);
    this.overview.set(null);
    try {
      const data = await this.general.overview(this.estateId);
      if (version === this.version) this.overview.set(data);
    } catch {
      if (version === this.version) this.loadError.set(true);
    }
  }

  // ── Tarjetas ─────────────────────────────────────────────────────────
  readonly community = computed<GeneralField[]>(() => {
    const e = this.estate();
    const o = this.overview();
    return [
      { label: 'Nombre', value: e.name },
      { label: 'Tipo', value: ESTATE_TYPE_LABEL[e.type] ?? e.type },
      { label: 'Año de construcción', value: e.yearBuilt ? String(e.yearBuilt) : null },
      { label: 'Nº de propiedades', value: o ? `${o.properties} ${o.properties === 1 ? 'unidad' : 'unidades'}` : null },
      { label: 'Uso principal', value: e.mainUse ?? null },
      { label: 'Referencia interna', value: e.internalRef ?? null },
      { label: 'Descripción', value: e.description?.trim() || null },
    ];
  });

  readonly address = computed<GeneralField[]>(() => {
    const e = this.estate();
    return [
      { label: 'Dirección', value: [e.address, e.streetNumber].filter(Boolean).join(' ') || null },
      { label: 'Código postal', value: e.postalCode ?? null },
      { label: 'Población', value: e.location || null },
      { label: 'Provincia', value: e.province ?? null },
    ];
  });

  /** openstreetmap.org: by coordinates when the backend located the estate, else by address. */
  readonly mapLink = computed(() => {
    const e = this.estate();
    if (e.latitude != null && e.longitude != null) {
      return `https://www.openstreetmap.org/?mlat=${e.latitude}&mlon=${e.longitude}#map=18/${e.latitude}/${e.longitude}`;
    }
    const query = [[e.address, e.streetNumber].filter(Boolean).join(' '), e.postalCode, e.location, e.province, 'España'].filter(Boolean).join(', ');
    return `https://www.openstreetmap.org/search?query=${encodeURIComponent(query)}`;
  });

  readonly fiscal = computed<GeneralField[]>(() => {
    const e = this.estate();
    const o = this.overview();
    const fy = o?.fiscalYear;
    return [
      { label: 'CIF', value: e.cif ?? null },
      { label: 'Régimen fiscal', value: e.taxRegime ?? null },
      { label: 'Año fiscal', value: fy ? `${SHORT_DAY.format(new Date(`${fy.startsOn}T00:00:00Z`))} – ${SHORT_DAY.format(new Date(`${fy.endsOn}T00:00:00Z`))} ${fy.year} (${fy.status.toLowerCase()})` : null },
      { label: 'Nº de cuenta contable', value: o?.bank?.accountCode ?? null },
      { label: 'Normativa aplicable', value: e.applicableLaw ?? null },
      { label: 'Fondo de reserva objetivo', value: e.reserveTarget > 0 ? EURO.format(e.reserveTarget) : null },
    ];
  });

  readonly bank = computed<GeneralField[]>(() => {
    const b = this.overview()?.bank;
    const e = this.estate();
    return [
      { label: 'Entidad', value: b?.bankName ?? null },
      { label: 'IBAN', value: b?.iban ?? null },
      { label: 'Titular', value: b ? e.name : null },
      { label: 'Uso', value: b ? 'Cobros de cuotas y pagos de la comunidad' : null },
    ];
  });

  readonly cadastral = computed<GeneralField[]>(() => {
    const e = this.estate();
    const s = this.overview()?.surface;
    const total = this.overview()?.properties ?? 0;
    const built = s?.builtAreaM2 != null
      ? `${area(s.builtAreaM2)}${s.builtAreaInformed < total ? ` (${s.builtAreaInformed} de ${total} propiedades)` : ''}`
      : null;
    return [
      { label: 'Referencia catastral', value: e.cadastralReference ?? null },
      { label: 'Superficie de parcela', value: area(e.parcelAreaM2 ?? s?.parcelAreaM2 ?? null) },
      { label: 'Superficie construida', value: built },
    ];
  });

  readonly coefficients = computed(() => {
    const c = this.overview()?.coefficients;
    if (!c) return null;
    const pct = (v: number) => `${QUOTA.format(v)} %`;
    return {
      fields: [
        { label: 'Total de coeficientes', value: c.informed ? pct(c.total) : null },
        { label: 'Mayor coeficiente', value: c.max ? `${c.max.ref} (${pct(c.max.value)})` : null },
        { label: 'Menor coeficiente', value: c.min ? `${c.min.ref} (${pct(c.min.value)})` : null },
      ] as GeneralField[],
      /** LPH art. 5: the shares of an estate add up to 100 %. */
      warning: c.missing > 0
        ? `${c.missing} ${c.missing === 1 ? 'propiedad sin coeficiente' : 'propiedades sin coeficiente'}`
        : c.informed && Math.abs(c.total - 100) > 0.005 ? 'La suma no llega al 100 %' : null,
    };
  });

  // ── Buscador ────────────────────────────────────────────────────────
  /** Visible text of each card, for the client-side search. */
  private readonly cardText = computed<Record<GeneralCardId, string>>(() => {
    const o = this.overview();
    const e = this.estate();
    const flat = (fields: GeneralField[]) => fields.map(f => `${f.label} ${f.value ?? ''}`).join(' ');
    return {
      community: `Datos de la comunidad ${flat(this.community())}`,
      address: `Dirección y ubicación ${flat(this.address())}`,
      contacts: `Contactos clave ${(o?.keyContacts ?? []).map(c => `${c.name} ${c.office ?? 'Propietario'} ${c.propertyRefs.join(' ')} ${c.phone ?? ''} ${c.email ?? ''}`).join(' ')}`,
      fiscal: `Datos fiscales administrativos ${flat(this.fiscal())}`,
      bank: `Cuenta bancaria ${flat(this.bank())}`,
      documents: `Documentos esenciales ${(o?.essentialDocuments ?? []).map(d => `${d.type} ${d.document?.title ?? ''}`).join(' ')}`,
      offices: `Presidente y cargos Presidente vicepresidente ${[o?.offices.president, ...(o?.offices.vicePresidents ?? [])].map(x => (x ? `${x.label} ${x.name} ${x.propertyRef ?? ''}` : '')).join(' ')}`,
      administrator: `Administrador asignado ${o?.administrator ? Object.values(o.administrator).join(' ') : ''}`,
      cadastral: `Referencia catastral ${flat(this.cadastral())}`,
      coefficients: `Coeficientes ${flat(this.coefficients()?.fields ?? [])}`,
      insurance: `Seguros básicos ${(o?.insurance ?? []).map(i => `Tipo de seguro ${i.type} Aseguradora ${i.insurer} Nº de póliza ${i.contractNumber ?? ''} Cobertura ${i.coverage ?? ''}`).join(' ')}`,
      notes: `Observaciones ${e.notes ?? ''}`,
    };
  });

  readonly visible = computed(() => {
    const term = fold(this.search().trim());
    const text = this.cardText();
    const ids = Object.keys(text) as GeneralCardId[];
    return new Set(term ? ids.filter(id => fold(text[id]).includes(term)) : ids);
  });

  readonly noMatches = computed(() => this.search().trim() !== '' && this.visible().size === 0);

  shows(id: GeneralCardId): boolean {
    return this.visible().has(id);
  }

  // ── Acciones de consulta (no editan nada) ────────────────────────────
  async copyIban(): Promise<void> {
    const iban = this.overview()?.bank?.iban;
    if (!iban) return;
    try {
      await navigator.clipboard.writeText(iban.replace(/\s/g, ''));
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      // Clipboard denied: the IBAN stays visible to copy by hand.
    }
  }

  readonly downloadError = signal('');

  async download(documentId: string, title: string): Promise<void> {
    this.downloadError.set('');
    try {
      const blob = await this.reads.downloadDocumentFile(documentId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = title;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch {
      this.downloadError.set(`No se pudo descargar «${title}».`);
    }
  }
}
