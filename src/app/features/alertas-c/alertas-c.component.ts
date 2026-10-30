import { Component, OnInit, signal, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { TopbarComponent } from '../../layout/topbar/topbar.component';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { BtnComponent } from '../../shared/components/btn/btn.component';
import { AlertItem, AlertType } from '../../core/models';
import { ResourceReadsService } from '../../core/resource-reads.service';
import { OWNER_DOCUMENTS_ROUTE, OWNER_ISSUES_ROUTE } from '../../core/legacy-owner-tab-redirect';
import { StateService } from '../../core/state.service';

type Filter = 'all' | 'unread' | 'pago' | 'comunidad';

/**
 * Vista de alertas del rol C.
 *
 * Antes: la interfaz `Alerta` y su mock vivían INLINE en este componente.
 * Ahora: las alertas son una PROYECCIÓN DERIVADA sobre recibos, incidencias,
 * comunicados, documentos y eventos — no hay tabla `alerts`. La persistencia
 * es solo `AlertRead` (estado leído/no-leído por usuario × recurso).
 *
 * Toda la lógica de derivación vive en `ResourceReadsService.listAlertsForUser`.
 */
@Component({
  selector: 'app-alertas-c',
  standalone: true,
  imports: [TopbarComponent, IconComponent, BtnComponent],
  templateUrl: './alertas-c.component.html',
  styleUrl: './alertas-c.component.scss'
})
export class AlertasCComponent implements OnInit {
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
    // Actualización optimista + persistencia en resource_reads.
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
   * "Pagar ahora"/"Ver recibos" (pago) y "Ver comunicado" (comunidad) — deep-link
   * por `?tab=` a property-detail (ver `applyQueryParamDeepLink`). "Ver solicitud"
   * (incidencia) abre su detalle en la página de incidencias (`?issue=<id>`).
   *
   * "Entrar a junta" (`sourceType: 'meeting'`) navega directo a la sala de
   * espera (`/wait/:id`), fuera del shell — no depende de `propertyId`.
   *
   * "Ver documento" abre ese documento en la página de Documentación (`?doc=<id>`), sin propiedad.
   */
  goToSource(a: AlertItem): void {
    if (a.type === 'junta' && a.sourceType === 'meeting') {
      this.router.navigate(['/wait', a.sourceId]);
      return;
    }
    if (a.type === 'documento') {
      this.router.navigate([OWNER_DOCUMENTS_ROUTE], { queryParams: a.sourceType === 'document' && a.sourceId ? { doc: a.sourceId } : {} });
      return;
    }
    // Una incidencia es de la comunidad: se abre en la ficha de incidencias de «Mi comunidad».
    if (a.type === 'incidencia') {
      this.router.navigate([OWNER_ISSUES_ROUTE], { queryParams: a.sourceType === 'issue' && a.sourceId ? { issue: a.sourceId } : {} });
      return;
    }
    // Pagos y comunicados cuelgan de una propiedad concreta; una incidencia es de la comunidad y no la necesita.
    if (!a.propertyId) return;
    if (a.type === 'pago') {
      this.router.navigate(['/c/properties', a.propertyId], { queryParams: { tab: 'receipts' } });
    } else if (a.type === 'comunidad') {
      this.router.navigate(['/c/properties', a.propertyId], { queryParams: { tab: 'communications' } });
    }
  }

  hasSourceLink(a: AlertItem): boolean {
    if (a.type === 'junta') return a.sourceType === 'meeting';
    if (a.type === 'incidencia') return true;
    return !!a.propertyId && (a.type === 'pago' || a.type === 'comunidad');
  }

  /**
   * "Descargar documento" — descarga directa, sin navegar: ya se tiene el
   * id real del documento (`a.sourceId`), replica exactamente el patrón de
   * `property-detail.downloadDocument`.
   */
  async downloadDocumento(a: AlertItem): Promise<void> {
    try {
      const blob = await this.data.downloadDocumentFile(a.sourceId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = a.description || 'documento';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error descargando el documento', error);
      this.showToast('No se pudo descargar el documento');
    }
  }

  // 'proveedor'/'presupuesto' nunca llegan para rol C (el backend jamás los
  // genera en listAlertsForOwner — un propietario no gestiona proveedores
  // ni presupuestos), pero Record<AlertType, string> exige el caso igual
  // por completitud de tipos.
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
