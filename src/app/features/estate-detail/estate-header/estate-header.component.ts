import { Component, EventEmitter, Output, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CommunityScopeService } from '../../../core/community-scope.service';
import { Estate } from '../../../core/models';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { EstateActionsMenuComponent } from '../../../shared/components/estate-actions-menu/estate-actions-menu.component';
import { StatusPillComponent } from '../../../shared/components/status-pill/status-pill.component';
import { EstateFacadeThumbnailComponent } from '../../dashboard-b/estate-facade-thumbnail/estate-facade-thumbnail.component';

/**
 * Cabecera de la ficha de finca: enlace de vuelta, fachada, nombre, estado,
 * dirección y el menú «Acciones» (el mismo del listado de fincas). Las acciones las ejecuta
 * el padre (`estate-detail`), que es quien conoce los modales y el wizard de alta.
 */
@Component({
  selector: 'app-estate-header',
  standalone: true,
  imports: [RouterLink, IconComponent, EstateActionsMenuComponent, StatusPillComponent, EstateFacadeThumbnailComponent],
  templateUrl: './estate-header.component.html',
  styleUrl: './estate-header.component.scss',
})
export class EstateHeaderComponent {
  readonly estate = input.required<Estate>();
  /** `null` mientras no se sabe (aún no ha llegado la puesta en marcha): no se pinta estado. */
  readonly setupRemaining = input<number | null>(null);

  @Output() edit = new EventEmitter<void>();
  @Output() officeHistory = new EventEmitter<void>();
  @Output() importCatastro = new EventEmitter<void>();
  @Output() newProperty = new EventEmitter<void>();
  @Output() openSetup = new EventEmitter<void>();

  private readonly scope = inject(CommunityScopeService);

  /** Con una comunidad elegida, `/b/estates` redirige a su ficha: se deja en «Todas» antes de volver al listado. */
  clearScope(): void {
    this.scope.select(null);
  }

  readonly address = computed(() => {
    const e = this.estate();
    const street = [e.address, e.streetNumber].filter(Boolean).join(' ');
    return [street, e.location].filter(Boolean).join(', ');
  });

  /** "Activa" cuando no queda nada imprescindible por configurar; si no, "En puesta en marcha". */
  readonly status = computed(() => {
    const remaining = this.setupRemaining();
    if (remaining === null) return null;
    return remaining > 0
      ? { text: 'En puesta en marcha', tone: 'warning' as const }
      : { text: 'Activa', tone: 'positive' as const };
  });
}
