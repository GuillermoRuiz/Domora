import { Component, EventEmitter, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { InspectionsService } from '../../../core/inspections.service';
import { installationTypeFor } from '../../../core/installation-types';
import { INSTALLATION_STATUS, reviewDeadlineLabel, type Installation } from '../../../core/installations.models';
import type { Inspection } from '../../../core/models';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { StatusPillComponent } from '../../../shared/components/status-pill/status-pill.component';

const DATE = new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
const day = (iso?: string | null): string => (iso ? DATE.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`)) : '—');

/**
 * Ficha de una instalación (solo lectura): sus datos, su estado y el
 * historial de sus inspecciones. Editar se hace desde aquí o desde el menú.
 */
@Component({
  selector: 'app-installation-detail-modal',
  standalone: true,
  imports: [IconComponent, StatusPillComponent],
  templateUrl: './installation-detail-modal.component.html',
  styleUrl: './installation-detail-modal.component.scss',
})
export class InstallationDetailModalComponent implements OnInit {
  @Input({ required: true }) estateId!: string;
  @Input({ required: true }) installation!: Installation;
  @Output() edit = new EventEmitter<void>();
  @Output() closed = new EventEmitter<void>();

  private inspections = inject(InspectionsService);

  readonly history = signal<Inspection[] | null>(null);
  readonly historyFailed = signal(false);

  readonly pill = computed(() => INSTALLATION_STATUS[this.installation.displayStatus]);
  readonly type = computed(() => installationTypeFor(this.installation.category));

  readonly details = computed(() => {
    const i = this.installation;
    const next = i.nextReviewDate ? `${day(i.nextReviewDate)} (${reviewDeadlineLabel(i.nextReviewDaysLeft)})` : '—';
    return [
      { id: 'type', label: 'Tipo', value: i.category },
      { id: 'location', label: 'Ubicación', value: i.location ?? '—' },
      { id: 'supplier', label: 'Proveedor', value: i.supplier?.name ?? '—' },
      { id: 'manufacturer', label: 'Fabricante', value: i.manufacturer ?? '—' },
      { id: 'serial', label: 'Nº de serie', value: i.serialNumber ?? '—' },
      { id: 'last', label: 'Última revisión', value: day(i.lastReviewDate) },
      { id: 'next', label: 'Próxima revisión', value: next },
      { id: 'issues', label: 'Incidencias abiertas', value: String(i.openIssues) },
    ];
  });

  /** Sus inspecciones, la más reciente primero (por la fecha que tengan: realizada, cita o vencimiento). */
  readonly rows = computed(() =>
    (this.history() ?? [])
      .map(inspection => {
        const date = inspection.lastDoneDate ?? inspection.appointmentDate ?? inspection.nextDueDate ?? null;
        return { id: inspection.id, title: inspection.inspectionType.name, status: inspection.status, date, label: day(date) };
      })
      .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')),
  );

  async ngOnInit(): Promise<void> {
    try {
      const all = await this.inspections.listInspectionsByEstate(this.estateId);
      this.history.set(all.filter(inspection => inspection.asset.id === this.installation.id));
    } catch (error) {
      console.error('Error cargando el historial de la instalación', error);
      this.historyFailed.set(true);
    }
  }
}
