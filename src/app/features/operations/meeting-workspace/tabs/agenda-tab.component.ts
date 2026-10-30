import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import { BtnComponent } from '../../../../shared/components/btn/btn.component';
import { MeetingCardComponent } from '../meeting-card.component';
import { StatusPillComponent } from '../status-pill.component';
import type { AgendaRow } from '../meeting-workspace.model';

/** Pestaña «Orden del día»: ¿qué puntos hay y en qué estado están? */
@Component({
  selector: 'app-meeting-agenda-tab',
  standalone: true,
  imports: [IconComponent, BtnComponent, MeetingCardComponent, StatusPillComponent],
  templateUrl: './agenda-tab.component.html',
  styleUrl: './agenda-tab.component.scss',
})
export class MeetingAgendaTabComponent {
  @Input({ required: true }) set rows(value: AgendaRow[]) {
    this.allRows.set(value);
  }
  /** Abrir el detalle del punto: su votación y el voto de cada propiedad. */
  @Output() openPoint = new EventEmitter<AgendaRow>();
  /** Abrir la votación del punto sin entrar en su detalle. */
  @Output() startVote = new EventEmitter<AgendaRow>();
  /** Cerrar la votación abierta del punto sin entrar en su detalle. */
  @Output() closeVote = new EventEmitter<AgendaRow>();
  /** Dar por tratado un punto sin votación. */
  @Output() markTreated = new EventEmitter<AgendaRow>();
  /** Quitar la marca de tratado de un punto sin votación. */
  @Output() unmarkTreated = new EventEmitter<AgendaRow>();
  /** Escribir o editar los comentarios del punto (salen en el acta). */
  @Output() editComments = new EventEmitter<AgendaRow>();

  private readonly allRows = signal<AgendaRow[]>([]);
  /** Punto desplegado (solo uno a la vez); ninguno hasta que se pulsa. */
  private readonly openId = signal<string | null>(null);
  readonly agenda = this.allRows.asReadonly();

  isOpen(row: AgendaRow): boolean {
    return this.openId() === row.id;
  }

  /** Pulsar un punto despliega su detalle justo debajo; pulsarlo de nuevo lo cierra. */
  toggle(row: AgendaRow): void {
    this.openId.update((current) => (current === row.id ? null : row.id));
  }

  votingOpen(row: AgendaRow): boolean {
    return row.statusLabel === 'En votación';
  }
}
