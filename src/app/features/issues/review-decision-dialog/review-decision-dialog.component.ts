import { Component, input, output } from '@angular/core';
import { AgendaTaskDetail } from '../../../core/agenda-tasks.model';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { ReviewNextStepPanelComponent, ReviewTaskRef } from '../../tasks/review-next-step-panel/review-next-step-panel.component';

/** «Decidir ahora»: el wizard «¿Cómo sigue esta incidencia?» en un modal, para no ocupar la página mientras no se usa. */
@Component({
  selector: 'app-review-decision-dialog',
  standalone: true,
  imports: [IconComponent, ReviewNextStepPanelComponent],
  template: `
    <div class="backdrop" (click)="closed.emit()">
      <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="decision-title" (click)="$event.stopPropagation()" (keydown.escape)="closed.emit()">
        <header class="dialog__header">
          <h4 id="decision-title">Decidir cómo sigue</h4>
          <button type="button" class="close-btn" aria-label="Cerrar" (click)="closed.emit()">
            <app-icon name="x" [size]="16"></app-icon>
          </button>
        </header>
        <div class="dialog__body">
          <app-review-next-step-panel [task]="task()" (decided)="decided.emit($event)" (resolved)="resolved.emit($event)"></app-review-next-step-panel>
        </div>
      </div>
    </div>
  `,
  styleUrl: './review-decision-dialog.component.scss',
})
export class ReviewDecisionDialogComponent {
  readonly task = input.required<ReviewTaskRef>();
  readonly decided = output<string>();
  readonly resolved = output<AgendaTaskDetail>();
  readonly closed = output<void>();
}
