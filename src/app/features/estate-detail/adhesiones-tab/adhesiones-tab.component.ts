import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { AvatarComponent } from '../../../shared/components/avatar/avatar.component';
import { BadgeComponent } from '../../../shared/components/badge/badge.component';
import { BtnComponent } from '../../../shared/components/btn/btn.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { AdhesionRequest, OwnerProperty } from '../../../core/models';
import { StateService } from '../../../core/state.service';
import { TicketsAdhesionService } from '../../../core/tickets-adhesion.service';

/**
 * Pestaña "Solicitudes de adhesión" de la finca, extraída de `estate-detail`.
 * El listado sigue siendo del padre (alimenta el contador de la pestaña y la
 * carga inicial): aquí solo se aprueba/rechaza y se avisa con `resolved` para
 * que el padre quite la solicitud de su lista.
 */
@Component({
  selector: 'app-adhesiones-tab',
  standalone: true,
  imports: [AvatarComponent, BadgeComponent, BtnComponent, IconComponent],
  templateUrl: './adhesiones-tab.component.html',
  styleUrl: './adhesiones-tab.component.scss',
})
export class AdhesionesTabComponent {
  @Input({ required: true }) estateId!: string;
  @Input({ required: true }) requests: AdhesionRequest[] = [];
  /** Para etiquetar la propiedad solicitada. */
  @Input() properties: OwnerProperty[] = [];
  @Output() resolved = new EventEmitter<string>();

  private adhesion = inject(TicketsAdhesionService);
  private state = inject(StateService);

  toastMessage = signal<string | null>(null);

  async approve(req: AdhesionRequest): Promise<void> {
    try {
      await this.adhesion.approveAdhesion(this.estateId, req.id);
      this.state.bumpNotifications();
      this.resolved.emit(req.id);
      this.showToast(`Solicitud de ${this.userName(req)} aprobada`);
    } catch (error) {
      console.error('Error aprobando la solicitud', error);
    }
  }

  async reject(req: AdhesionRequest): Promise<void> {
    try {
      await this.adhesion.rejectAdhesion(this.estateId, req.id);
      this.state.bumpNotifications();
      this.resolved.emit(req.id);
      this.showToast(`Solicitud de ${this.userName(req)} rechazada`);
    } catch (error) {
      console.error('Error rechazando la solicitud', error);
    }
  }

  /** El listado de adhesiones de la API incluye el usuario embebido. */
  userName(req: AdhesionRequest): string {
    return (req as AdhesionRequest & { user?: { fullName?: string } }).user?.fullName ?? 'Usuario desconocido';
  }

  userEmail(req: AdhesionRequest): string {
    return (req as AdhesionRequest & { user?: { email?: string } }).user?.email ?? '';
  }

  propertyLabel(req: AdhesionRequest): string {
    if (!req.propertyId) return 'Propiedad no especificada';
    const p = this.properties.find(x => x.id === req.propertyId);
    return p ? `${p.type} ${p.ref ?? p.id}` : 'Propiedad desconocida';
  }

  dateLabel(req: AdhesionRequest): string {
    const date = new Date(req.submittedAt);
    if (Number.isNaN(date.getTime())) return '—';
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${day}-${month}-${date.getFullYear()}`;
  }

  private showToast(msg: string): void {
    this.toastMessage.set(msg);
    setTimeout(() => this.toastMessage.set(null), 2500);
  }
}
