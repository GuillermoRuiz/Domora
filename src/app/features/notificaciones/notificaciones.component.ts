import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TopbarComponent } from '../../layout/topbar/topbar.component';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { BtnComponent } from '../../shared/components/btn/btn.component';
import { NotificationCategory, NotificationItem, TaskItem } from '../../core/models';
import { NotificationsService } from '../../core/notifications.service';
import { StateService } from '../../core/state.service';

type Tab = 'avisos' | 'tareas';
type ReadFilter = 'all' | 'unread';

const CATEGORY_ICON: Record<NotificationCategory, string> = {
  adhesion: 'user',
  onboarding: 'building',
  issue: 'exclamation',
  direct_message: 'send',
  inspection: 'search',
  meeting: 'users',
  communication: 'mail',
  booking: 'calendar',
  receipt: 'receipt',
  billing: 'card',
  task: 'calendar',
  document: 'file-text',
};

const CATEGORY_LABEL: Record<NotificationCategory, string> = {
  adhesion: 'Adhesión',
  onboarding: 'Alta de comunidad',
  issue: 'Incidencia',
  direct_message: 'Mensaje',
  inspection: 'Inspección',
  meeting: 'Junta',
  communication: 'Comunicado',
  booking: 'Reserva',
  receipt: 'Recibo',
  billing: 'Facturación',
  task: 'Tarea',
  document: 'Documento',
};

/**
 * Bandeja unificada de notificaciones — un único componente compartido por
 * rol A/B/C (mismo patrón que `MensajesComponent`): la pestaña "Avisos" la
 * ven los tres roles; "Tareas" (estado derivado, sin leído/no-leído) solo
 * la ven A/B, que son quienes gestionan.
 *
 * Complementa a `alertas-b`/`alertas-c` (el feed derivado de Alertas, que
 * sigue existiendo tal cual) — esta bandeja cubre lo que ese feed no cubre:
 * solicitudes, mensajes directos, incidencias, juntas cerradas,
 * inspecciones y comunicados urgentes.
 */
@Component({
  selector: 'app-notificaciones',
  standalone: true,
  imports: [TopbarComponent, IconComponent, BtnComponent],
  templateUrl: './notificaciones.component.html',
  styleUrl: './notificaciones.component.scss',
})
export class NotificacionesComponent implements OnInit {
  private data = inject(NotificationsService);
  private state = inject(StateService);
  private router = inject(Router);

  isManager = computed(() => this.state.currentRole() === 'B' || this.state.currentRole() === 'A');

  tab = signal<Tab>('avisos');
  readFilter = signal<ReadFilter>('all');

  items = signal<NotificationItem[]>([]);
  tasks = signal<TaskItem[]>([]);
  loading = signal(true);
  toastMessage = signal<string | null>(null);

  unreadCount = computed(() => this.items().filter((n) => !n.read).length);
  pendingTaskCount = computed(() => this.tasks().reduce((sum, t) => sum + t.count, 0));

  filteredItems = computed(() => {
    if (this.readFilter() === 'unread') return this.items().filter((n) => !n.read);
    return this.items();
  });

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  private async reload(): Promise<void> {
    this.loading.set(true);
    try {
      const [items, tasks] = await Promise.all([
        this.data.list(),
        this.isManager() ? this.data.listTasks() : Promise.resolve([]),
      ]);
      this.items.set(items);
      this.tasks.set(tasks);
    } catch (error) {
      console.error('Error cargando la bandeja de notificaciones', error);
    } finally {
      this.loading.set(false);
    }
  }

  categoryIcon(category: NotificationCategory): string {
    return CATEGORY_ICON[category];
  }

  categoryLabel(category: NotificationCategory): string {
    return CATEGORY_LABEL[category];
  }

  dateLabel(iso: string): string {
    return new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  /** Marca como leído (si hacía falta) y navega a su destino. */
  async open(item: NotificationItem): Promise<void> {
    if (!item.read) {
      this.items.update((list) => list.map((n) => (n.id === item.id ? { ...n, read: true } : n)));
      try {
        await this.data.markRead(item.id);
      } catch (error) {
        console.error('Error marcando la notificación como leída', error);
      }
    }
    void this.router.navigateByUrl(item.link);
  }

  openTask(task: TaskItem): void {
    void this.router.navigateByUrl(task.link);
  }

  async markAllRead(): Promise<void> {
    try {
      await this.data.markAllRead();
      this.items.update((list) => list.map((n) => ({ ...n, read: true })));
      this.showToast('Todas las notificaciones marcadas como leídas');
    } catch (error) {
      console.error('Error marcando todas las notificaciones', error);
    }
  }

  private showToast(msg: string): void {
    this.toastMessage.set(msg);
    setTimeout(() => this.toastMessage.set(null), 2400);
  }
}
