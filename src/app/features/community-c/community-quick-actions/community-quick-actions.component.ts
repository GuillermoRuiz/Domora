import { Component, input, output } from '@angular/core';
import { IconComponent } from '../../../shared/components/icon/icon.component';

export type QuickAction = 'issue' | 'message' | 'receipts' | 'acta';

/** «Accesos rápidos»: lo que un propietario hace más a menudo, a un clic. «Descargar acta» solo se activa si hay un acta firmada. */
@Component({
  selector: 'app-community-quick-actions',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './community-quick-actions.component.html',
  styleUrl: './community-quick-actions.component.scss',
})
export class CommunityQuickActionsComponent {
  /** Hay una junta celebrada con acta firmada que descargar. */
  readonly actaAvailable = input(false);
  readonly run = output<QuickAction>();
}
