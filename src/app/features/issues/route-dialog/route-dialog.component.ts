import { Component, computed, input, output, signal } from '@angular/core';
import { BtnComponent } from '../../../shared/components/btn/btn.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { ROUTE_LABEL, ResolutionRoute } from '../../../core/issue-workflow.models';
import { RouteGuideComponent } from '../route-guide/route-guide.component';

/** Lo que devuelve el diálogo: la vía elegida y, si salió de las preguntas, el motivo que se deja en el historial. */
export interface RouteChoice {
  route: ResolutionRoute;
  reason?: string;
}

/**
 * «Resolver vía»: ventana con el desplegable de la vía de gestión (y, si se quiere, las preguntas que ayudan a elegirla).
 * Solo recoge la elección: guarda la pantalla.
 */
@Component({
  selector: 'app-route-dialog',
  standalone: true,
  imports: [BtnComponent, IconComponent, RouteGuideComponent],
  templateUrl: './route-dialog.component.html',
  styleUrl: './route-dialog.component.scss',
})
export class RouteDialogComponent {
  /** La vía vigente (`null` = sin decidir). */
  readonly current = input<ResolutionRoute | null>(null);
  readonly busy = input(false);
  readonly saved = output<RouteChoice>();
  readonly closed = output<void>();

  readonly labels = ROUTE_LABEL;
  readonly route = signal<ResolutionRoute | null | undefined>(undefined);
  readonly reason = signal('');
  readonly guided = signal(false);
  /** La vía que muestra el desplegable: la que se acaba de elegir o, si no, la vigente. */
  readonly selected = computed(() => (this.route() === undefined ? this.current() : this.route()));
  readonly canSave = computed(() => !!this.selected() && this.selected() !== this.current() && !this.busy());

  setRoute(route: ResolutionRoute | null): void {
    this.route.set(route);
  }

  save(): void {
    const route = this.selected();
    if (!route || !this.canSave()) return;
    this.saved.emit({ route, ...(this.reason() ? { reason: this.reason() } : {}) });
  }
}
