import { Component, EventEmitter, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { SelectDropdownDirective } from '../../../../shared/components/dropdown/select-dropdown.directive';
import { FormsModule } from '@angular/forms';
import { InspectionsService } from '../../../../core/inspections.service';
import { SuppliersStaffService } from '../../../../core/suppliers-staff.service';
import { visitDate, visitTime, type SupplierPanelRow, type SupplierTone, type SupplierVisit, type SupplierVisitStatus } from '../../../../core/supplier-panel.models';
import { BtnComponent } from '../../../../shared/components/btn/btn.component';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import { StatusPillComponent } from '../../../../shared/components/status-pill/status-pill.component';

/** Mensaje legible de un error de la API (el backend manda `message` como texto o como lista). */
function messageFrom(error: unknown, fallback: string): string {
  const message = (error as { error?: { message?: unknown } })?.error?.message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message) && message.length > 0) return message.join(' ');
  return fallback;
}

const VISIT_STATUS: Record<SupplierVisitStatus, { text: string; tone: SupplierTone }> = {
  planificada: { text: 'Planificada', tone: 'info' },
  realizada: { text: 'Realizada', tone: 'positive' },
  cancelada: { text: 'Cancelada', tone: 'neutral' },
};

/** Hora por defecto al programar una visita. */
const DEFAULT_TIME = '09:00';

const pad = (n: number) => String(n).padStart(2, '0');
/** AAAA-MM-DD en la hora local (lo que espera un `<input type="date">`). */
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

type Mode = 'list' | 'form';

/**
 * Visitas de un proveedor: histórico y próximas, con lo que se puede hacer a
 * cada una (editar, marcar como realizada, cancelar) y el formulario para
 * programar otra. Cada cambio avisa al panel (`changed`) para que actualice
 * la «próxima visita» y las «últimas intervenciones» sin cerrar el modal.
 */
@Component({
  selector: 'app-supplier-visits-modal',
  standalone: true,
  imports: [SelectDropdownDirective, FormsModule, BtnComponent, IconComponent, StatusPillComponent],
  templateUrl: './supplier-visits-modal.component.html',
  styleUrl: './supplier-visits-modal.component.scss',
})
export class SupplierVisitsModalComponent implements OnInit {
  @Input({ required: true }) estateId!: string;
  @Input({ required: true }) supplier!: SupplierPanelRow;
  /** Abre directamente el formulario de una visita nueva. */
  @Input() startWithForm = false;
  /** Se creó, editó o cerró una visita: el panel recarga. */
  @Output() changed = new EventEmitter<void>();
  @Output() closed = new EventEmitter<void>();

  private api = inject(SuppliersStaffService);
  private inspections = inject(InspectionsService);

  readonly mode = signal<Mode>('list');
  readonly visits = signal<SupplierVisit[] | null>(null);
  readonly loadFailed = signal(false);
  readonly installations = signal<{ id: string; name: string }[]>([]);

  // ── Formulario ──────────────────────────────────────────────────────
  /** null = visita nueva. */
  readonly editing = signal<SupplierVisit | null>(null);
  readonly date = signal('');
  readonly time = signal(DEFAULT_TIME);
  readonly purpose = signal('');
  readonly notes = signal('');
  /** '' = sin instalación. */
  readonly assetId = signal('');
  readonly submitted = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly dateInvalid = computed(() => this.submitted() && this.date() === '');
  readonly purposeInvalid = computed(() => this.submitted() && this.purpose().trim() === '');

  readonly purposeSuggestions = ['Revisión periódica', 'Reparación', 'Presupuesto', 'Mantenimiento'];

  // ── Cierre de una visita (realizada / cancelada) ────────────────────
  /** Visita a la que se está pidiendo confirmar el cierre, con la acción elegida. */
  readonly closing = signal<{ id: string; action: 'complete' | 'cancel' } | null>(null);
  readonly closingNotes = signal('');

  /** Planificadas primero (la más cercana arriba) y el histórico después (lo más reciente arriba). */
  readonly sortedVisits = computed(() => {
    const all = this.visits() ?? [];
    const planned = all.filter(v => v.status === 'planificada').sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
    const past = all.filter(v => v.status !== 'planificada').sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt));
    return [...planned, ...past];
  });

  statusInfo(visit: SupplierVisit) {
    return VISIT_STATUS[visit.status];
  }
  dateLabel(iso: string): string {
    return visitDate(iso);
  }
  timeLabel(iso: string): string {
    return visitTime(iso);
  }
  links(visit: SupplierVisit): string {
    return [visit.asset ? `Instalación: ${visit.asset.name}` : null, visit.issue ? `Incidencia ${visit.issue.ref}` : null]
      .filter((l): l is string => !!l).join(' · ');
  }

  async ngOnInit(): Promise<void> {
    if (this.startWithForm) this.openForm(null);
    await this.load();
  }

  private async load(): Promise<void> {
    try {
      this.visits.set(await this.api.listSupplierVisits(this.estateId, this.supplier.id));
      this.loadFailed.set(false);
    } catch (error) {
      console.error('Error cargando las visitas del proveedor', error);
      if (this.visits() === null) this.loadFailed.set(true);
    }
  }

  /** Instalaciones de la finca para vincular la visita (opcional); sin lista se puede programar igual. */
  private async loadInstallations(): Promise<void> {
    if (this.installations().length > 0) return;
    try {
      const { items } = await this.inspections.listInstallations(this.estateId);
      this.installations.set(items.map(i => ({ id: i.id, name: i.name })).sort((a, b) => a.name.localeCompare(b.name, 'es')));
    } catch (error) {
      console.error('Error cargando las instalaciones de la finca', error);
    }
  }

  openForm(visit: SupplierVisit | null): void {
    this.closing.set(null);
    this.editing.set(visit);
    this.submitted.set(false);
    this.error.set(null);
    if (visit) {
      const when = new Date(visit.scheduledAt);
      this.date.set(localDate(when));
      this.time.set(localTime(when));
      this.purpose.set(visit.purpose);
      this.notes.set(visit.notes ?? '');
      this.assetId.set(visit.asset?.id ?? '');
    } else {
      this.date.set('');
      this.time.set(DEFAULT_TIME);
      this.purpose.set('');
      this.notes.set('');
      this.assetId.set('');
    }
    this.mode.set('form');
    void this.loadInstallations();
  }

  backToList(): void {
    this.mode.set('list');
    this.editing.set(null);
    this.error.set(null);
  }

  async submit(): Promise<void> {
    this.submitted.set(true);
    if (this.date() === '' || this.purpose().trim() === '' || this.saving()) return;
    this.saving.set(true);
    this.error.set(null);
    try {
      const scheduledAt = new Date(`${this.date()}T${this.time() || DEFAULT_TIME}`).toISOString();
      const target = this.editing();
      if (target) {
        // Vaciar notas o instalación las borra (`null`).
        await this.api.updateSupplierVisit(this.estateId, this.supplier.id, target.id, {
          scheduledAt,
          purpose: this.purpose().trim(),
          notes: this.notes().trim() || null,
          assetId: this.assetId() || null,
        });
      } else {
        await this.api.createSupplierVisit(this.estateId, this.supplier.id, {
          scheduledAt,
          purpose: this.purpose().trim(),
          ...(this.notes().trim() && { notes: this.notes().trim() }),
          ...(this.assetId() && { assetId: this.assetId() }),
        });
      }
      await this.load();
      this.changed.emit();
      this.backToList();
    } catch (error) {
      console.error('Error guardando la visita', error);
      this.error.set(messageFrom(error, 'No se pudo guardar la visita. Inténtalo de nuevo.'));
    } finally {
      this.saving.set(false);
    }
  }

  askClose(visit: SupplierVisit, action: 'complete' | 'cancel'): void {
    this.closingNotes.set('');
    this.error.set(null);
    this.closing.set({ id: visit.id, action });
  }
  dismissClose(): void {
    this.closing.set(null);
  }

  async confirmClose(): Promise<void> {
    const pending = this.closing();
    if (!pending || this.saving()) return;
    this.saving.set(true);
    this.error.set(null);
    try {
      const notes = this.closingNotes().trim() || undefined;
      if (pending.action === 'complete') await this.api.completeSupplierVisit(this.estateId, this.supplier.id, pending.id, notes);
      else await this.api.cancelSupplierVisit(this.estateId, this.supplier.id, pending.id, notes);
      this.closing.set(null);
      await this.load();
      this.changed.emit();
    } catch (error) {
      console.error('Error cerrando la visita', error);
      this.error.set(messageFrom(error, 'No se pudo actualizar la visita. Inténtalo de nuevo.'));
    } finally {
      this.saving.set(false);
    }
  }
}
