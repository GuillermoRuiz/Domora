import { Component, EventEmitter, Input, OnDestroy, Output, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BtnComponent } from '../../../shared/components/btn/btn.component';
import { BadgeComponent } from '../../../shared/components/badge/badge.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { CatastroService } from '../../../core/catastro.service';
import { isCatastroReference, normalizeReference } from '../../../core/catastro-reference';
import { formatQuota } from '../../../core/format';
import {
  CatastroImportResult, CatastroLookup, CatastroLookupQuery, CatastroProvince,
  CatastroStreet, CatastroUnit, OwnerPropertyType,
} from '../../../core/models';

import { SelectDropdownDirective } from '../../../shared/components/dropdown/select-dropdown.directive';
/** Datos de la finca que preseleccionan la búsqueda. */
export interface CatastroImportEstate {
  id: string;
  address: string;
  streetNumber?: string | null;
  location: string;
  province?: string | null;
  cadastralReference?: string | null;
}

type Step = 'search' | 'review' | 'done';
type SearchMode = 'ref' | 'address';

/** Tipo de vía al principio de la dirección de la finca ("Calle Mayor" → "Mayor"): el Catastro busca por el nombre sin el tipo. */
const LEADING_VIA_TYPE = /^(calle|c\/|cl\.?|avenida|avda\.?|av\.?|plaza|pza\.?|pl\.?|paseo|ps\.?|camino|carretera|ctra\.?|travesía|travesia|ronda|glorieta)\s+/i;

const DEBOUNCE_MS = 300;

/** Sin tildes y en mayúsculas, para comparar el nombre de una provincia sin depender de cómo se escribió. */
function fold(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().trim();
}

/**
 * Importación masiva de las unidades de una finca desde el Catastro: buscar
 * (por referencia catastral o por dirección) → revisar/editar → importar. La
 * consulta NO escribe nada; solo "Importar" crea propiedades, y solo las
 * seleccionadas. Es la alternativa a dar de alta cada vivienda a mano.
 *
 * Los datos que devuelve el Catastro son públicos y no incluyen titulares —
 * por eso las propiedades se crean vacías y sin propietario.
 */
@Component({
  selector: 'app-catastro-import-modal',
  standalone: true,
  imports: [FormsModule, BtnComponent, BadgeComponent, IconComponent, SelectDropdownDirective],
  templateUrl: './catastro-import-modal.component.html',
  styleUrl: './catastro-import-modal.component.scss',
})
export class CatastroImportModalComponent implements OnDestroy {
  @Input({ required: true }) estate!: CatastroImportEstate;

  @Input()
  set open(value: boolean) {
    this.openSignal.set(value);
  }
  get open(): boolean {
    return this.openSignal();
  }

  @Output() closed = new EventEmitter<void>();
  @Output() imported = new EventEmitter<CatastroImportResult>();

  private readonly catastro = inject(CatastroService);
  private readonly openSignal = signal(false);

  readonly propertyTypes: OwnerPropertyType[] = ['Piso', 'Casa', 'Parking', 'Trastero', 'Local'];
  readonly formatQuota = formatQuota;

  step = signal<Step>('search');
  mode = signal<SearchMode>('ref');
  loading = signal(false);
  errorMsg = signal<string | null>(null);

  // ── Búsqueda ─────────────────────────────────────────────────────────
  refCat = signal('');
  provinces = signal<CatastroProvince[]>([]);
  /** Mientras carga, Provincia queda deshabilitada (con spinner) y Municipio/Calle/Número dependen de ella en cascada. */
  provincesLoading = signal(false);
  province = signal('');
  municipality = signal('');
  municipalitySuggestions = signal<string[]>([]);
  streetQuery = signal('');
  streetSuggestions = signal<CatastroStreet[]>([]);
  selectedStreet = signal<CatastroStreet | null>(null);
  number = signal('');

  // ── Revisión ─────────────────────────────────────────────────────────
  lookup = signal<CatastroLookup | null>(null);
  /** Copias editables de las unidades (el tipo y el coeficiente se pueden corregir antes de importar). */
  units = signal<CatastroUnit[]>([]);
  selectedRefs = signal<ReadonlySet<string>>(new Set());
  result = signal<CatastroImportResult | null>(null);

  /**
   * Dirección confirmada por el Catastro, a partir de la primera unidad
   * (todas las de una misma parcela comparten calle y número salvo
   * excepciones muy raras). Antes esto no se mostraba en ningún sitio: la
   * revisión solo mostraba la referencia catastral de la parcela, así que
   * tras buscar por dirección no había forma de confirmar que el Catastro
   * encontró la calle correcta — ni tampoco en modo "por referencia
   * catastral", donde nunca se eligió una calle de las sugerencias.
   */
  catastroAddress = computed<string | null>(() => {
    const u = this.units()[0];
    if (!u) return null;
    const street = [u.viaType, u.viaName].filter(Boolean).join(' ');
    const number = u.streetNumber ? `${u.streetNumber}${u.streetNumberSuffix ?? ''}` : null;
    const line = [street, number].filter(Boolean).join(', ');
    if (!line) return null;
    const location = [u.postalCode, u.municipality].filter(Boolean).join(' ');
    return location ? `${line} (${location})` : line;
  });

  /** Unidades marcables: las que la finca ya tiene no se pueden volver a importar. */
  importableUnits = computed(() => this.units().filter((u) => !u.alreadyImported));
  selectedUnits = computed(() => this.units().filter((u) => this.selectedRefs().has(u.cadastralReference)));
  selectedQuotaSum = computed(() =>
    Math.round(this.selectedUnits().reduce((acc, u) => acc + (u.participationQuota ?? 0), 0) * 100) / 100,
  );
  allSelected = computed(() => this.importableUnits().length > 0 && this.selectedUnits().length === this.importableUnits().length);

  private municipalityTimer: ReturnType<typeof setTimeout> | null = null;
  private streetTimer: ReturnType<typeof setTimeout> | null = null;
  /** Descarta respuestas de autocompletado que llegan tarde (anti-carrera). */
  private municipalitySeq = 0;
  private streetSeq = 0;

  constructor() {
    // Se inicializa al ABRIR, en un effect y no en el setter de `open`: así
    // `estate` ya está asignado sin depender del orden de los inputs.
    effect(() => {
      if (this.openSignal()) untracked(() => void this.onOpen());
      else this.clearTimers();
    });
  }

  ngOnDestroy(): void {
    this.clearTimers();
  }

  private async onOpen(): Promise<void> {
    this.resetAll();
    const estate = this.estate;
    // El municipio de la finca es su localidad; el Catastro busca por nombre de vía sin el tipo.
    this.municipality.set(estate.location);
    this.streetQuery.set(estate.address.replace(LEADING_VIA_TYPE, '').trim());
    this.number.set((estate.streetNumber ?? '').match(/\d{1,4}/)?.[0] ?? '');
    if (estate.cadastralReference) {
      this.mode.set('ref');
      this.refCat.set(estate.cadastralReference);
    } else {
      this.mode.set('address');
    }

    this.provincesLoading.set(true);
    try {
      const provinces = await this.catastro.provinces();
      this.provinces.set(provinces);
      if (estate.province) {
        const wanted = fold(estate.province);
        this.province.set(provinces.find((p) => fold(p.name) === wanted)?.name ?? '');
      }
      // Con provincia y municipio conocidos, ya se puede proponer la calle de la finca.
      if (this.province() && this.municipality() && this.streetQuery().length >= 2) {
        await this.searchStreets();
      }
    } catch {
      // El catálogo es solo una ayuda: sin él se puede buscar por referencia catastral.
      this.errorMsg.set('No se pudo cargar el catálogo del Catastro. Puedes buscar por referencia catastral.');
    } finally {
      this.provincesLoading.set(false);
    }
  }

  setMode(mode: SearchMode): void {
    this.mode.set(mode);
    this.errorMsg.set(null);
  }

  // ── Autocompletado ───────────────────────────────────────────────────
  onProvinceChange(value: string): void {
    this.province.set(value);
    this.municipalitySuggestions.set([]);
    this.streetSuggestions.set([]);
    this.selectedStreet.set(null);
  }

  onMunicipalityInput(value: string): void {
    this.municipality.set(value);
    this.streetSuggestions.set([]);
    this.selectedStreet.set(null);
    if (this.municipalityTimer) clearTimeout(this.municipalityTimer);
    if (value.trim().length < 2 || !this.province()) {
      this.municipalitySuggestions.set([]);
      return;
    }
    this.municipalityTimer = setTimeout(() => void this.searchMunicipalities(), DEBOUNCE_MS);
  }

  private async searchMunicipalities(): Promise<void> {
    const seq = ++this.municipalitySeq;
    try {
      const found = await this.catastro.municipalities(this.province(), this.municipality().trim());
      if (seq === this.municipalitySeq) this.municipalitySuggestions.set(found.slice(0, 8));
    } catch {
      if (seq === this.municipalitySeq) this.municipalitySuggestions.set([]);
    }
  }

  pickMunicipality(name: string): void {
    this.municipality.set(name);
    this.municipalitySuggestions.set([]);
    if (this.streetQuery().trim().length >= 2) void this.searchStreets();
  }

  onStreetInput(value: string): void {
    this.streetQuery.set(value);
    this.selectedStreet.set(null);
    if (this.streetTimer) clearTimeout(this.streetTimer);
    if (value.trim().length < 2 || !this.province() || !this.municipality().trim()) {
      this.streetSuggestions.set([]);
      return;
    }
    this.streetTimer = setTimeout(() => void this.searchStreets(), DEBOUNCE_MS);
  }

  async searchStreets(): Promise<void> {
    const seq = ++this.streetSeq;
    try {
      const found = await this.catastro.streets(this.province(), this.municipality().trim(), this.streetQuery().trim());
      if (seq === this.streetSeq) this.streetSuggestions.set(found.slice(0, 10));
    } catch {
      if (seq === this.streetSeq) this.streetSuggestions.set([]);
    }
  }

  pickStreet(street: CatastroStreet): void {
    this.selectedStreet.set(street);
    this.streetQuery.set(street.name);
    this.streetSuggestions.set([]);
  }

  // ── Consulta ─────────────────────────────────────────────────────────
  private buildQuery(): CatastroLookupQuery | null {
    if (this.mode() === 'ref') {
      const refCat = normalizeReference(this.refCat());
      if (!isCatastroReference(refCat)) {
        this.errorMsg.set('La referencia catastral debe tener 14, 18 o 20 caracteres (letras y números).');
        return null;
      }
      return { refCat };
    }
    const street = this.selectedStreet();
    const number = this.number().trim();
    if (!this.province() || !this.municipality().trim()) {
      this.errorMsg.set('Indica la provincia y el municipio.');
      return null;
    }
    if (!street) {
      this.errorMsg.set('Escribe la calle y elige una de las sugerencias del Catastro.');
      return null;
    }
    if (!/^\d{1,4}$/.test(number)) {
      this.errorMsg.set('El número debe tener entre 1 y 4 dígitos.');
      return null;
    }
    return { provincia: this.province(), municipio: this.municipality().trim(), sigla: street.sigla, calle: street.name, numero: number };
  }

  async search(): Promise<void> {
    if (this.loading()) return;
    this.errorMsg.set(null);
    const query = this.buildQuery();
    if (!query) return;
    this.loading.set(true);
    try {
      const lookup = await this.catastro.lookup(this.estate.id, query);
      this.lookup.set(lookup);
      this.units.set(lookup.units.map((u) => ({ ...u })));
      this.selectedRefs.set(new Set(lookup.units.filter((u) => !u.alreadyImported).map((u) => u.cadastralReference)));
      this.step.set('review');
    } catch (err) {
      this.errorMsg.set(this.messageFrom(err, 'No se pudo consultar el Catastro.'));
    } finally {
      this.loading.set(false);
    }
  }

  // ── Revisión ─────────────────────────────────────────────────────────
  isSelected(u: CatastroUnit): boolean {
    return this.selectedRefs().has(u.cadastralReference);
  }

  toggle(u: CatastroUnit): void {
    if (u.alreadyImported) return;
    const next = new Set(this.selectedRefs());
    if (next.has(u.cadastralReference)) next.delete(u.cadastralReference);
    else next.add(u.cadastralReference);
    this.selectedRefs.set(next);
  }

  toggleAll(): void {
    this.selectedRefs.set(
      this.allSelected() ? new Set() : new Set(this.importableUnits().map((u) => u.cadastralReference)),
    );
  }

  setType(u: CatastroUnit, type: OwnerPropertyType): void {
    this.patchUnit(u, { type });
  }

  /** `null` (campo vacío) deja la unidad sin coeficiente; se ignora lo que no sea un 0-100 válido. */
  setQuota(u: CatastroUnit, value: number | string | null): void {
    if (value === null || value === '') {
      this.patchUnit(u, { participationQuota: null });
      return;
    }
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 100) return;
    this.patchUnit(u, { participationQuota: Math.round(n * 100) / 100 });
  }

  private patchUnit(u: CatastroUnit, patch: Partial<CatastroUnit>): void {
    this.units.update((list) => list.map((x) => (x.cadastralReference === u.cadastralReference ? { ...x, ...patch } : x)));
  }

  unitLabel(u: CatastroUnit): string {
    const parts = [
      u.block && `Bl. ${u.block}`,
      u.staircase && `Esc. ${u.staircase}`,
      u.floor && `Planta ${u.floor}`,
      u.door && `Pta. ${u.door}`,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(' · ') : 'Sin división horizontal';
  }

  fetchedAtLabel(): string {
    const at = this.lookup()?.source.fetchedAt;
    return at ? new Date(at).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
  }

  // ── Importación ──────────────────────────────────────────────────────
  async importSelected(): Promise<void> {
    const lookup = this.lookup();
    const selected = this.selectedUnits();
    if (!lookup || selected.length === 0 || this.loading()) return;
    this.errorMsg.set(null);
    this.loading.set(true);
    try {
      const result = await this.catastro.importUnits(this.estate.id, {
        parcelReference: lookup.source.parcelReference,
        fetchedAt: lookup.source.fetchedAt,
        units: selected,
      });
      this.result.set(result);
      this.step.set('done');
      this.imported.emit(result);
    } catch (err) {
      this.errorMsg.set(this.messageFrom(err, 'No se pudieron importar las propiedades.'));
    } finally {
      this.loading.set(false);
    }
  }

  backToSearch(): void {
    this.errorMsg.set(null);
    this.step.set('search');
  }

  close(): void {
    this.closed.emit();
  }

  // ── Internos ─────────────────────────────────────────────────────────
  private resetAll(): void {
    this.clearTimers();
    this.step.set('search');
    this.loading.set(false);
    this.errorMsg.set(null);
    this.refCat.set('');
    this.province.set('');
    this.municipality.set('');
    this.municipalitySuggestions.set([]);
    this.streetQuery.set('');
    this.streetSuggestions.set([]);
    this.selectedStreet.set(null);
    this.number.set('');
    this.lookup.set(null);
    this.units.set([]);
    this.selectedRefs.set(new Set());
    this.result.set(null);
  }

  private clearTimers(): void {
    if (this.municipalityTimer) clearTimeout(this.municipalityTimer);
    if (this.streetTimer) clearTimeout(this.streetTimer);
    this.municipalityTimer = null;
    this.streetTimer = null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private messageFrom(err: any, fallback: string): string {
    if (err?.status === 429) return 'Demasiadas consultas seguidas al Catastro. Espera un minuto e inténtalo de nuevo.';
    const msg = err?.error?.message;
    if (typeof msg === 'string' && msg) return msg;
    if (Array.isArray(msg) && msg.length > 0) return msg.join(' ');
    return fallback;
  }
}
