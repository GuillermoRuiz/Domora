import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { BtnComponent } from '../../shared/components/btn/btn.component';
import { StatCardComponent } from '../../shared/components/stat-card/stat-card.component';
import { EstatesService } from '../../core/estates.service';
import { ImportsService, type ImportRollbackResult } from '../../core/imports.service';
import {
  ColumnPreset,
  Estate,
  ImportBatch,
  ImportCommitSummary,
  ImportEntityType,
  ImportScope,
  ImportSourcePlatform,
  ImportValidationSummary,
} from '../../core/models';

import { SelectDropdownDirective } from '../../shared/components/dropdown/select-dropdown.directive';
interface NoImportadoRow {
  label: string;
  sub: string;
  reason: string;
}

interface EntityTypeOption {
  value: ImportEntityType;
  label: string;
  scope: ImportScope;
}

/** El scope no es una elección aparte del usuario — se deriva de qué tipo de dato eligió importar. */
const ENTITY_TYPE_OPTIONS: EntityTypeOption[] = [
  { value: 'property', label: 'Propiedades', scope: 'current_state' },
  { value: 'owner', label: 'Propietarios', scope: 'current_state' },
  { value: 'movement', label: 'Movimientos (libro mayor)', scope: 'historical_accounting' },
  { value: 'receipt', label: 'Recibos', scope: 'historical_accounting' },
  { value: 'remesa', label: 'Remesas ya presentadas', scope: 'historical_accounting' },
  { value: 'opening-balance', label: 'Saldos iniciales (bancos, deudas, anticipos, otros)', scope: 'historical_accounting' },
  { value: 'supplier-invoice', label: 'Facturas de proveedor pendientes', scope: 'historical_accounting' },
];

/** Estas dos entidades solo rellenan el borrador de saldos iniciales — nunca contabilizan, así que el backend rechaza deshacerlas (no hay nada propio que revertir). */
const OPENING_ENTITY_TYPES: ReadonlySet<ImportEntityType> = new Set(['opening-balance', 'supplier-invoice']);

/**
 * Categorías detectadas en Gesfincas/Fynkus que Domora todavía no modela
 * (ver plan sprightly-snacking-yao.md §8) — contenido estático de la
 * pantalla de resumen, NO viene del backend. El fichero original se
 * conserva íntegro (`ImportBatch.rawFileKey`), así que nada de esto se
 * pierde: solo no se aterriza en ninguna tabla de dominio todavía.
 */
const NO_IMPORTADO: NoImportadoRow[] = [
  { label: 'Juntas / Actas', sub: 'Convocatorias, asistencia y votos', reason: 'Domora no gestiona esto todavía' },
  { label: 'Seguros y siniestros', sub: 'Pólizas y siniestros', reason: 'Domora no gestiona esto todavía' },
  { label: 'Nómina', sub: 'Personal y payroll', reason: 'Domora no gestiona esto todavía' },
  { label: 'Firma electrónica en documentos', sub: 'Firma digital en documentos subidos', reason: 'Domora no gestiona esto todavía' },
];

@Component({
  selector: 'app-migracion',
  standalone: true,
  imports: [FormsModule, IconComponent, BtnComponent, StatCardComponent, SelectDropdownDirective],
  templateUrl: './migracion.component.html',
  styleUrl: './migracion.component.scss',
})
export class MigracionComponent implements OnInit {
  private estatesSvc = inject(EstatesService);
  private imports = inject(ImportsService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  noImportado = NO_IMPORTADO;
  entityTypeOptions = ENTITY_TYPE_OPTIONS;

  steps = [
    { n: 1, label: 'Origen' },
    { n: 2, label: 'Subir fichero' },
    { n: 3, label: 'Mapeo' },
    { n: 4, label: 'Revisión' },
    { n: 5, label: 'Confirmar' },
  ];

  step = signal(1);

  // ── Paso 1 — Origen ──────────────────────────────────────────────────
  estates = signal<Estate[]>([]);
  loadingEstates = signal(true);
  selectedEstateId = signal('');
  sourcePlatform = signal<ImportSourcePlatform>('GESFINCAS_NET');
  entityType = signal<ImportEntityType>('property');

  selectedEstate = computed(() => this.estates().find(e => e.id === this.selectedEstateId()) ?? null);
  selectedEntityTypeLabel = computed(
    () => this.entityTypeOptions.find(o => o.value === this.entityType())?.label ?? this.entityType(),
  );
  isOpeningEntity = computed(() => OPENING_ENTITY_TYPES.has(this.entityType()));

  // ── Paso 2 — Subir fichero ───────────────────────────────────────────
  selectedFile = signal<File | null>(null);
  uploading = signal(false);
  uploadError = signal<string | null>(null);
  batch = signal<ImportBatch | null>(null);
  headers = signal<string[]>([]);
  sampleRows = signal<Record<string, string>[]>([]);
  totalRows = signal(0);

  // ── Paso 3 — Mapeo de columnas ───────────────────────────────────────
  presetFields = signal<ColumnPreset[]>([]);
  loadingPresets = signal(false);
  mapping = signal<Record<string, string | undefined>>({});

  requiredMissing = computed(() =>
    this.presetFields().some(f => f.required && !this.mapping()[f.targetField]),
  );

  // ── Paso 4 — Revisión ────────────────────────────────────────────────
  validating = signal(false);
  validateError = signal<string | null>(null);
  validationSummary = signal<ImportValidationSummary | null>(null);

  // ── Paso 5 — Confirmar ───────────────────────────────────────────────
  committing = signal(false);
  commitError = signal<string | null>(null);
  commitSummary = signal<ImportCommitSummary | null>(null);

  // ── Paso 6 — Resumen / deshacer ──────────────────────────────────────
  rollingBack = signal(false);
  rollbackError = signal<string | null>(null);
  rolledBack = signal(false);
  rollbackResult = signal<ImportRollbackResult | null>(null);

  /** 'se eliminaron 3 propiedades y 2 propietarios' — solo lo que el deshacer tocó de verdad. */
  rollbackSummary(r: ImportRollbackResult): string {
    const parts = [
      r.removedProperties && `se eliminaron ${r.removedProperties} propiedades`,
      r.removedOwners && `se eliminaron ${r.removedOwners} propietarios`,
      r.removedReceipts && `se anularon ${r.removedReceipts} recibos`,
      r.removedRemesas && `se eliminaron ${r.removedRemesas} remesas`,
      r.reversedEntries && `se revirtieron ${r.reversedEntries} asientos con su contraasiento`,
    ].filter((p): p is string => !!p);
    if (!parts.length) return 'no quedaba nada que deshacer';
    return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}`;
  }

  /** Si se llegó desde la puesta en marcha de una finca, al terminar se vuelve a ella en vez de a Ajustes. */
  returnToSetup = signal(false);

  async ngOnInit(): Promise<void> {
    try {
      this.estates.set(await this.estatesSvc.listEstates());
    } catch (error) {
      console.error('Error cargando fincas para la importación', error);
    } finally {
      this.loadingEstates.set(false);
    }
    this.applyQueryParams();
  }

  /**
   * `?estateId=&entity=&returnTo=setup` (enlaces de la puesta en marcha).
   * Solo preselecciona: el paso 1 sigue a la vista porque ahí se elige
   * también el programa de origen. Un `estateId` que no esté entre las
   * fincas cargadas se ignora — nunca se importa a una finca que el
   * usuario no ve en la lista.
   */
  private applyQueryParams(): void {
    const params = this.route.snapshot.queryParamMap;
    const estateId = params.get('estateId');
    const estateIsKnown = !!estateId && this.estates().some(e => e.id === estateId);
    if (estateIsKnown) this.selectedEstateId.set(estateId);

    const entity = params.get('entity');
    if (entity && this.entityTypeOptions.some(o => o.value === entity)) {
      this.entityType.set(entity as ImportEntityType);
    }

    this.returnToSetup.set(estateIsKnown && params.get('returnTo') === 'setup');
  }

  canAdvance = computed(() => {
    switch (this.step()) {
      case 1: return !!this.selectedEstateId();
      case 2: return !!this.selectedFile() && !this.uploading();
      case 3: return !this.requiredMissing() && !this.loadingPresets() && !this.validating();
      case 4: return !!this.validationSummary();
      default: return true;
    }
  });

  continueLabel(): string {
    if (this.step() === 2 && this.uploading()) return 'Subiendo…';
    if (this.step() === 3 && this.validating()) return 'Validando…';
    return 'Continuar';
  }

  next(): void {
    switch (this.step()) {
      case 1:
        this.step.set(2);
        break;
      case 2:
        void this.uploadAndParse();
        break;
      case 3:
        void this.goToReview();
        break;
      case 4:
        this.step.set(5);
        break;
    }
  }

  back(): void {
    if (this.step() > 1 && this.step() < 6) this.step.update(s => s - 1);
  }

  close(): void {
    if (this.returnToSetup() && this.selectedEstateId()) {
      this.router.navigate(['/b/estates', this.selectedEstateId()]);
      return;
    }
    this.router.navigate(['/b/settings']);
  }

  /** Tras importar bancos/deudas/anticipos/otros o facturas, el borrador queda relleno — el siguiente paso natural es revisarlo y contabilizarlo. */
  goToOpeningWizard(): void {
    const estateId = this.selectedEstateId();
    if (!estateId) return;
    this.router.navigate(['/b/accounting', estateId], { queryParams: { tab: 'opening' } });
  }

  /**
   * Tras importar propiedades, los propietarios son el paso natural
   * siguiente (el importador de propietarios exige que las propiedades ya
   * existan). Vuelve al paso 1 con la misma finca y "Propietarios" elegido.
   */
  importOwnersNext(): void {
    this.entityType.set('owner');
    this.selectedFile.set(null);
    this.uploadError.set(null);
    this.batch.set(null);
    this.headers.set([]);
    this.sampleRows.set([]);
    this.totalRows.set(0);
    this.presetFields.set([]);
    this.mapping.set({});
    this.validateError.set(null);
    this.validationSummary.set(null);
    this.commitError.set(null);
    this.commitSummary.set(null);
    this.rollbackError.set(null);
    this.rolledBack.set(false);
    this.rollbackResult.set(null);
    this.step.set(1);
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedFile.set(input.files?.[0] ?? null);
    this.uploadError.set(null);
  }

  private async uploadAndParse(): Promise<void> {
    const file = this.selectedFile();
    const estateId = this.selectedEstateId();
    if (!file || !estateId || this.uploading()) return;
    this.uploading.set(true);
    this.uploadError.set(null);
    try {
      const scope = this.entityTypeOptions.find(o => o.value === this.entityType())?.scope ?? 'current_state';
      const batch = await this.imports.createImportBatch(estateId, file, this.sourcePlatform(), scope);
      this.batch.set(batch);
      const parsed = await this.imports.parseImportBatch(estateId, batch.id);
      this.headers.set(parsed.headers);
      this.sampleRows.set(parsed.sampleRows);
      this.totalRows.set(parsed.totalRows);
      await this.loadPresets();
      this.step.set(3);
    } catch (error) {
      console.error('Error subiendo el fichero de importación', error);
      this.uploadError.set('No se pudo subir el fichero. Comprueba que sea un CSV/Excel válido y no supere 25MB.');
    } finally {
      this.uploading.set(false);
    }
  }

  private async loadPresets(): Promise<void> {
    this.loadingPresets.set(true);
    try {
      const res = await this.imports.getImportPresets(
        this.selectedEstateId(),
        this.sourcePlatform(),
        this.entityType(),
        this.headers(),
      );
      this.presetFields.set(res.fields);
      this.mapping.set({ ...res.suggestedMapping });
    } catch (error) {
      console.error('Error cargando los presets de mapeo', error);
    } finally {
      this.loadingPresets.set(false);
    }
  }

  setMapping(targetField: string, header: string): void {
    const current = { ...this.mapping() };
    if (header) current[targetField] = header;
    else delete current[targetField];
    this.mapping.set(current);
  }

  private async goToReview(): Promise<void> {
    const b = this.batch();
    const estateId = this.selectedEstateId();
    if (!b || !estateId || this.requiredMissing() || this.validating()) return;
    this.validating.set(true);
    this.validateError.set(null);
    try {
      // `setMapping()` borra la clave (no la deja en `undefined`) cuando el usuario quita un mapeo,
      // así que el objeto real nunca tiene valores undefined pese al tipo del signal — ver `setMapping`.
      const mapping = this.mapping() as Record<string, string>;
      const { summary } = await this.imports.validateImportMapping(estateId, b.id, this.entityType(), mapping);
      this.validationSummary.set(summary);
      this.step.set(4);
    } catch (error) {
      console.error('Error validando el mapeo de columnas', error);
      this.validateError.set('No se pudo validar el fichero con este mapeo. Revisa las columnas seleccionadas.');
    } finally {
      this.validating.set(false);
    }
  }

  /** CSV de filas con error/aviso — con BOM para que Excel lo abra con acentos. */
  exportErrorsCsv(): void {
    const summary = this.validationSummary();
    if (!summary) return;
    const header = ['Fila', 'Tipo', 'Mensaje'];
    const rows: string[][] = [];
    for (const e of summary.errors) {
      for (const msg of e.errors) rows.push([String(e.rowNumber), 'Error', msg]);
    }
    for (const w of summary.warnings) {
      for (const msg of w.warnings) rows.push([String(w.rowNumber), 'Aviso', msg]);
    }
    const csvLines = [header, ...rows]
      .map(cols => cols.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';'));

    const blob = new Blob(['﻿' + csvLines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `import-errores-${this.batch()?.id ?? 'lote'}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  async commit(): Promise<void> {
    const b = this.batch();
    const estateId = this.selectedEstateId();
    if (!b || !estateId || this.committing()) return;
    this.committing.set(true);
    this.commitError.set(null);
    try {
      const result = await this.imports.commitImportBatch(estateId, b.id);
      this.commitSummary.set(result);
      this.step.set(6);
    } catch (error) {
      console.error('Error confirmando la importación', error);
      this.commitError.set('No se pudo confirmar la importación. Inténtalo de nuevo.');
    } finally {
      this.committing.set(false);
    }
  }

  async rollback(): Promise<void> {
    const b = this.batch();
    const estateId = this.selectedEstateId();
    if (!b || !estateId || this.rollingBack()) return;
    if (!confirm('¿Deshacer esta importación? Se eliminarán las propiedades/propietarios creados por este lote.')) return;
    this.rollingBack.set(true);
    this.rollbackError.set(null);
    try {
      const result = await this.imports.rollbackImportBatch(estateId, b.id);
      this.rollbackResult.set(result);
      this.rolledBack.set(true);
    } catch (error: any) {
      console.error('Error deshaciendo la importación', error);
      const msg = error?.error?.message;
      this.rollbackError.set(typeof msg === 'string' ? msg : 'No se pudo deshacer la importación.');
    } finally {
      this.rollingBack.set(false);
    }
  }
}
