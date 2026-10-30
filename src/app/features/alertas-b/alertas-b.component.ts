import { Component, OnInit, signal, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { TopbarComponent } from '../../layout/topbar/topbar.component';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { BtnComponent } from '../../shared/components/btn/btn.component';
import { AlertItem, AlertType } from '../../core/models';
import { ResourceReadsService } from '../../core/resource-reads.service';
import { StateService } from '../../core/state.service';

type Filter = 'all' | 'unread' | 'pago' | 'comunidad';

/**
 * Vista de alertas del rol B — mismo feed derivado que alertas-c
 * (`ResourceReadsService.listAlertsForUser` → `GET /alerts`, que en backend rama por
 * rol), pero con CTAs propias de gestión (ver incidencia / ver recibos) en
 * vez de "pagar"/"confirmar asistencia" (acciones de propietario).
 */
@Component({
  selector: 'app-alertas-b',
  standalone: true,
  imports: [TopbarComponent, IconComponent, BtnComponent],
  templateUrl: './alertas-b.component.html',
  styleUrl: './alertas-b.component.scss'
})
export class AlertasBComponent implements OnInit {
  private data = inject(ResourceReadsService);
  private state = inject(StateService);
  private router = inject(Router);

  alertas = signal<AlertItem[]>([]);

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  private async reload(): Promise<void> {
    try {
      this.alertas.set(await this.data.listAlertsForUser());
    } catch (error) {
      console.error('Error cargando alertas', error);
    }
  }

  filter = signal<Filter>('all');
  expanded = signal<string | null>(null);
  toastMessage = signal<string | null>(null);

  unread = computed(() => this.alertas().filter(a => !a.read).length);

  filtered = computed(() => {
    const filter = this.filter();
    return this.alertas().filter(a => {
      if (filter === 'unread') return !a.read;
      if (filter === 'pago') return a.type === 'pago';
      if (filter === 'comunidad') return a.type === 'comunidad' || a.type === 'junta' || a.type === 'documento';
      return true;
    });
  });

  showToast(msg: string): void {
    this.toastMessage.set(msg);
    setTimeout(() => this.toastMessage.set(null), 2400);
  }

  async markRead(a: AlertItem): Promise<void> {
    this.alertas.set(this.alertas().map(x => x.id === a.id ? { ...x, read: true } : x));
    try {
      await this.data.markAlertRead('', a.sourceType, a.sourceId);
      this.state.bumpNotifications();
    } catch (error) {
      console.error('Error marcando la alerta como leída', error);
    }
  }

  async markAllRead(): Promise<void> {
    try {
      await this.data.markAllAlertsRead();
      await this.reload();
      this.state.bumpNotifications();
      this.showToast('Todas las alertas marcadas como leídas');
    } catch (error) {
      console.error('Error marcando las alertas', error);
    }
  }

  toggleExpanded(a: AlertItem): void {
    if (!a.read) void this.markRead(a);
    this.expanded.set(this.expanded() === a.id ? null : a.id);
  }

  /**
   * "Ver incidencia" (issues + entidad) / "Ver recibos" (tab receipts) /
   * "Ver documento" (tab documents en estate-detail) — deep-link por `?tab=`.
   * "Panel de anfitrión" (junta con videollamada, `sourceType: 'meeting'`)
   * — navega directo a `/beacon/:id`, fuera del shell.
   *
   * Las juntas SIN videollamada (`sourceType: 'event'`, derivadas de
   * `propertyEvent`) se quedan sin CTA a propósito: un `propertyEvent` no
   * tiene ningún módulo de gestión al que enlazar. Añadir un botón que
   * fuera a ningún sitio sería el mismo problema que se está arreglando en
   * otro lado, no una solución.
   */
  goToSource(a: AlertItem): void {
    if (a.type === 'junta' && a.sourceType === 'meeting') {
      this.router.navigate(['/beacon', a.sourceId]);
      return;
    }
    if (!a.estateId) return;
    if (a.type === 'incidencia') {
      this.router.navigate(['/b/estates', a.estateId], { queryParams: { tab: 'issues', entity: a.sourceId } });
    } else if (a.type === 'pago') {
      this.router.navigate(['/b/accounting', a.estateId], { queryParams: { tab: 'receipts' } });
    } else if (a.type === 'documento') {
      this.router.navigate(['/b/estates', a.estateId], { queryParams: { tab: 'documents' } });
    } else if (a.type === 'comunidad') {
      this.router.navigate(['/b/estates', a.estateId], { queryParams: { tab: 'communications' } });
    } else if (a.type === 'proveedor') {
      this.router.navigate(['/b/accounting', a.estateId], { queryParams: { tab: 'suppliers' } });
    } else if (a.type === 'presupuesto') {
      this.router.navigate(['/b/accounting', a.estateId], { queryParams: { tab: 'budget' } });
    }
  }

  hasSourceLink(a: AlertItem): boolean {
    if (a.type === 'junta') return a.sourceType === 'meeting';
    return !!a.estateId && (a.type === 'incidencia' || a.type === 'pago' || a.type === 'documento' || a.type === 'comunidad' || a.type === 'proveedor' || a.type === 'presupuesto');
  }

  sourceLinkLabel(a: AlertItem): string {
    if (a.type === 'junta') return 'Panel de anfitrión';
    if (a.type === 'incidencia') return 'Ver incidencia';
    if (a.type === 'documento') return 'Ver documento';
    if (a.type === 'comunidad') return 'Ver comunicado';
    if (a.type === 'proveedor') return 'Ver proveedor';
    if (a.type === 'presupuesto') return 'Ver presupuesto';
    return 'Ver recibos';
  }

  typeIcon(type: AlertType): string {
    const map: Record<AlertType, string> = {
      pago: 'card', incidencia: 'exclamation', junta: 'users', documento: 'key', comunidad: 'building', proveedor: 'store', presupuesto: 'chart',
    };
    return map[type];
  }

  typeLabel(type: AlertType): string {
    const map: Record<AlertType, string> = {
      pago: 'Pago', incidencia: 'Incidencia', junta: 'Junta', documento: 'Documento', comunidad: 'Comunidad', proveedor: 'Proveedor', presupuesto: 'Presupuesto',
    };
    return map[type];
  }

  typeClass(type: AlertType): string {
    return 'alert-type--' + type;
  }
}
