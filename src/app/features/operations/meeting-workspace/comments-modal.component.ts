import { DOCUMENT } from '@angular/common';
import { Component, ElementRef, EventEmitter, Input, OnDestroy, OnInit, Output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BtnComponent } from '../../../shared/components/btn/btn.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import type { AgendaRow } from './meeting-workspace.model';

/** Lo que el modal necesita de un punto; sirve también para un texto libre del acta (`number` vacío). */
export type CommentsTarget = Pick<AgendaRow, 'number' | 'title' | 'comments'>;

/** Longitud máxima de los comentarios de un punto (la misma que valida el backend). */
export const MAX_COMMENTS = 2000;

/**
 * Comentarios del administrador sobre un punto del orden del día (o un texto libre del acta):
 * cualquier texto relacionado, que después se refleja en el acta.
 */
@Component({
  selector: 'app-meeting-comments-modal',
  standalone: true,
  imports: [FormsModule, IconComponent, BtnComponent],
  templateUrl: './comments-modal.component.html',
  styleUrl: './comments-modal.component.scss',
})
export class MeetingCommentsModalComponent implements OnInit, OnDestroy {
  @Input({ required: true }) row!: CommentsTarget;
  /** Título del diálogo. */
  @Input() heading = 'Comentarios del punto';
  /** Explicación bajo el título; por defecto, la de un punto del orden del día. */
  @Input() description = 'Escribe cualquier cosa relacionada con este punto. Aparecerá en el acta, bajo el punto.';
  @Input() placeholder = 'Intervenciones, reservas de voto, acuerdos verbales…';
  /** Longitud máxima (la misma que valida el backend). */
  @Input() max = MAX_COMMENTS;
  @Input() busy = false;
  @Input() error = '';
  @Output() save = new EventEmitter<string>();
  @Output() closed = new EventEmitter<void>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly text = signal('');

  constructor() {
    // Como el resto de modales de la junta: se cuelga del <body> para cubrir toda la ventana.
    inject(DOCUMENT).body.appendChild(this.host.nativeElement);
  }

  ngOnInit(): void {
    this.text.set(this.row.comments);
  }

  ngOnDestroy(): void {
    this.host.nativeElement.remove();
  }

  /** Sin cambios no hay nada que guardar. */
  get unchanged(): boolean {
    return this.text().trim() === this.row.comments.trim();
  }

  submit(): void {
    if (this.busy || this.unchanged) return;
    this.save.emit(this.text());
  }

  close(): void {
    if (!this.busy) this.closed.emit();
  }
}
