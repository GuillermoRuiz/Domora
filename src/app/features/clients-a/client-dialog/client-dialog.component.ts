import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { LeadsService } from '../../../core/leads.service';
import type { CommercialFollowUp } from '../../../core/models';
import { BtnComponent } from '../../../shared/components/btn/btn.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { fmtDay } from '../clients-a-table';

/**
 * «Próxima acción» and «seguimiento comercial» of a despacho client (S13),
 * reachable from its row in Clientes without leaving the list.
 */
@Component({
  selector: 'app-client-dialog',
  standalone: true,
  imports: [BtnComponent, IconComponent],
  template: `
    <div class="modal-backdrop" (click)="closed.emit()">
      <div class="modal" role="dialog" aria-modal="true" [attr.aria-label]="'Seguimiento comercial de ' + clientName()" (click)="$event.stopPropagation()">
        <div class="modal__header">
          <h3>{{ clientName() }}</h3>
          <button type="button" class="close-btn" aria-label="Cerrar" (click)="closed.emit()"><app-icon name="x" [size]="18"></app-icon></button>
        </div>
        <div class="modal__body">
          <div class="form-grid">
            <label class="form-field">
              <span class="form-label">Próxima acción</span>
              <input class="form-input" type="text" maxlength="300" placeholder="Ej.: llamar para la renovación" data-field="nextAction" [value]="action()" (input)="action.set($any($event.target).value)" />
            </label>
            <label class="form-field">
              <span class="form-label">Fecha</span>
              <input class="form-input" type="date" data-field="nextActionAt" [value]="actionAt()" (input)="actionAt.set($any($event.target).value)" />
            </label>
          </div>

          <section class="followups" aria-label="Seguimiento comercial">
            <h4 class="section-title">Seguimiento comercial</h4>
            <div class="followup-form">
              <textarea class="form-textarea" rows="2" maxlength="2000" data-field="followup" aria-label="Nuevo seguimiento" placeholder="Qué se habló, qué se acordó…" [value]="followUpText()" (input)="followUpText.set($any($event.target).value)"></textarea>
              <app-btn variant="outline" size="sm" data-action="add-client-followup" [disabled]="!followUpText().trim() || busy()" (clicked)="addFollowUp()">Añadir seguimiento</app-btn>
            </div>
            <ul class="followup-list" data-followups>
              @for (f of followUps(); track f.id) {
                <li>
                  <span class="followup-meta">{{ fmtDay(f.occurredAt) }} · {{ f.author }}</span>
                  <span class="followup-text">{{ f.text }}</span>
                </li>
              } @empty {
                <li class="followup-empty">{{ loading() ? 'Cargando…' : 'Sin seguimiento todavía.' }}</li>
              }
            </ul>
          </section>

          @if (error()) { <p class="form-error" role="alert">{{ error() }}</p> }
        </div>
        <div class="modal__footer">
          <app-btn variant="outline" (clicked)="closed.emit()">Cancelar</app-btn>
          <app-btn variant="primary" data-action="save-next-action" [disabled]="busy()" (clicked)="save()">Guardar próxima acción</app-btn>
        </div>
      </div>
    </div>
  `,
  styleUrl: './client-dialog.component.scss',
})
export class ClientDialogComponent implements OnInit {
  private leadsSvc = inject(LeadsService);

  readonly administratorId = input.required<string>();
  readonly clientName = input.required<string>();
  readonly nextAction = input<string | null>(null);
  readonly nextActionAt = input<string | null>(null);
  readonly closed = output<void>();
  readonly saved = output<void>();

  readonly fmtDay = fmtDay;

  action = signal('');
  actionAt = signal('');
  followUps = signal<CommercialFollowUp[]>([]);
  followUpText = signal('');
  loading = signal(true);
  busy = signal(false);
  error = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    this.action.set(this.nextAction() ?? '');
    this.actionAt.set(this.nextActionAt() ?? '');
    try {
      this.followUps.set(await this.leadsSvc.clientFollowUps(this.administratorId()));
    } catch {
      this.error.set('No se pudo cargar el seguimiento comercial.');
    } finally {
      this.loading.set(false);
    }
  }

  async save(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.leadsSvc.setClientNextAction(this.administratorId(), {
        nextAction: this.action().trim() || null,
        nextActionAt: this.actionAt() || null,
      });
      this.saved.emit();
    } catch {
      this.error.set('No se pudo guardar la próxima acción.');
    } finally {
      this.busy.set(false);
    }
  }

  async addFollowUp(): Promise<void> {
    const text = this.followUpText().trim();
    if (!text) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const entry = await this.leadsSvc.addClientFollowUp(this.administratorId(), text);
      this.followUps.set([entry, ...this.followUps()]);
      this.followUpText.set('');
    } catch {
      this.error.set('No se pudo añadir el seguimiento.');
    } finally {
      this.busy.set(false);
    }
  }
}
