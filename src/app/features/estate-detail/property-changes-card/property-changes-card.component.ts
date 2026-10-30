import { Component, Input, OnInit, computed, inject, signal } from '@angular/core';
import type { ActivitySubjectType, EstateActivityItem } from '../../../core/estate-dashboard.models';
import { EstateDashboardService } from '../../../core/estate-dashboard.service';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { SectionCardComponent } from '../../../shared/components/section-card/section-card.component';
import { activityTimeLabel } from '../activity-card/activity-card.component';

/** Lo que cuenta como "alta o cambio" de propiedades: altas masivas del Catastro y titularidades. */
const SUBJECTS = ['property', 'membership'];
const COLLAPSED = 5;
const EXPANDED = 15;

const ICON: Partial<Record<ActivitySubjectType, string>> = { membership: 'users', property: 'building' };

/** "Últimas altas y cambios": lo último que ha pasado con las propiedades de la finca. */
@Component({
  selector: 'app-property-changes-card',
  standalone: true,
  imports: [SectionCardComponent, IconComponent],
  templateUrl: './property-changes-card.component.html',
  styleUrl: './property-changes-card.component.scss',
})
export class PropertyChangesCardComponent implements OnInit {
  @Input({ required: true }) estateId!: string;

  private dashboard = inject(EstateDashboardService);

  readonly items = signal<EstateActivityItem[] | null>(null);
  readonly failed = signal(false);
  readonly expanded = signal(false);
  readonly loading = signal(false);

  readonly actionLabel = computed(() => (this.expanded() ? 'Ver menos' : 'Ver todos'));

  readonly rows = computed(() => {
    const now = new Date();
    return (this.items() ?? []).map(item => ({
      id: item.id,
      summary: item.summary,
      detail: [item.propertyRef ? `Prop. ${item.propertyRef}` : null, item.actorName ? `por ${item.actorName}` : null].filter(Boolean).join(' · '),
      time: activityTimeLabel(item.occurredAt, now),
      icon: ICON[item.subjectType] ?? 'building',
    }));
  });

  ngOnInit(): Promise<void> {
    return this.load();
  }

  async toggle(): Promise<void> {
    this.expanded.set(!this.expanded());
    await this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.items.set((await this.dashboard.getActivity(this.estateId, this.expanded() ? EXPANDED : COLLAPSED, SUBJECTS)).items);
      this.failed.set(false);
    } catch (error) {
      console.error('Error cargando las altas y cambios de propiedades', error);
      // Si ya había una lista, se conserva: solo falla el "ver más".
      if (this.items() === null) this.failed.set(true);
    } finally {
      this.loading.set(false);
    }
  }
}
