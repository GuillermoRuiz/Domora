import { Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TopbarComponent } from '../../layout/topbar/topbar.component';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { ActivityItem, ActivityType } from '../../core/models';
import { ResourceReadsService } from '../../core/resource-reads.service';
import { OWNER_DOCUMENTS_ROUTE, OWNER_ISSUES_ROUTE, ownerDocumentQueryParams, ownerIssueQueryParams } from '../../core/legacy-owner-tab-redirect';
import { OWNER_RECEIPTS_ROUTE } from '../../core/owner-routes';

const ACTIVITY_LIMIT = 100;

/** Pantalla "Ver todo" del feed de actividad de dashboard-c — mismo `ResourceReadsService.listActivityForUser`, límite mayor. */
@Component({
  selector: 'app-activity-c',
  standalone: true,
  imports: [TopbarComponent, IconComponent],
  templateUrl: './activity-c.component.html',
  styleUrl: './activity-c.component.scss'
})
export class ActivityCComponent implements OnInit {
  private router = inject(Router);
  private data = inject(ResourceReadsService);

  activities = signal<ActivityItem[]>([]);
  loading = signal(true);

  async ngOnInit(): Promise<void> {
    try {
      this.activities.set(await this.data.listActivityForUser(undefined, ACTIVITY_LIMIT));
    } catch (error) {
      console.error('Error cargando la actividad', error);
    } finally {
      this.loading.set(false);
    }
  }

  activityColor(type: ActivityType): string {
    const map: Record<ActivityType, string> = {
      'incidencia': 'var(--color-error)',
      'recibo': 'var(--color-warning)',
      'comunicado': '#2563EB',
      'documento': 'var(--color-secondary)',
      'solicitud': 'var(--color-accent)',
    };
    return map[type];
  }

  activityIcon(type: ActivityType): string {
    const map: Record<ActivityType, string> = {
      'incidencia': 'exclamation',
      'recibo': 'receipt',
      'comunicado': 'mail',
      'documento': 'file',
      'solicitud': 'check',
    };
    return map[type];
  }

  /**
   * La incidencia es de la comunidad (siempre se puede abrir); el recibo necesita su `propertyId` real
   * y un documento abre la página de Documentación (sin propiedad). Los comunicados no tienen destino.
   */
  activityClickable(item: ActivityItem): boolean {
    return item.type === 'incidencia' || item.type === 'documento' || (item.type === 'recibo' && !!item.propertyId);
  }

  openActivity(item: ActivityItem): void {
    if (!this.activityClickable(item)) return;
    if (item.type === 'incidencia') {
      this.router.navigate([OWNER_ISSUES_ROUTE], { queryParams: ownerIssueQueryParams(item.id) });
      return;
    }
    if (item.type === 'documento') {
      this.router.navigate([OWNER_DOCUMENTS_ROUTE], { queryParams: ownerDocumentQueryParams(item.id) });
      return;
    }
    this.router.navigate([OWNER_RECEIPTS_ROUTE], { queryParams: { propertyId: item.propertyId } });
  }
}
