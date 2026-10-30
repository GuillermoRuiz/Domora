import { DOCUMENT } from '@angular/common';
import { Component, ElementRef, EventEmitter, Input, OnDestroy, OnInit, Output, computed, inject, signal } from '@angular/core';
import { BtnComponent } from '../../../../shared/components/btn/btn.component';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import { customOptionColor } from '../../../../shared/vote-option-colors';
import { choiceTone, type PointQuestion, type Tone, type VoteRow } from '../meeting-workspace.model';

export interface RegisteredChoice {
  optionIndex?: number;
  optionIndexes?: number[];
}

/**
 * La gestora emite (o cambia) el voto de una propiedad presente o representada.
 * Se elige la opción —o varias si la pregunta es de selección múltiple— y el voto
 * consta a nombre de quien vota (el titular o su representante) y de la gestora.
 */
@Component({
  selector: 'app-meeting-vote-registration-modal',
  standalone: true,
  imports: [IconComponent, BtnComponent],
  templateUrl: './vote-registration-modal.component.html',
  styleUrl: './vote-registration-modal.component.scss',
})
export class MeetingVoteRegistrationModalComponent implements OnInit, OnDestroy {
  @Input({ required: true }) row!: VoteRow;
  @Input({ required: true }) question!: PointQuestion;
  @Input() busy = false;
  @Input() error = '';
  @Output() confirm = new EventEmitter<RegisteredChoice>();
  @Output() closed = new EventEmitter<void>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly selected = signal<number[]>([]);
  readonly multiple = computed(() => this.question.type === 'multiple_choice');
  readonly changing = computed(() => this.row.state === 'voted');

  constructor() {
    // Como el modal de representación: se cuelga del <body> para cubrir toda la ventana.
    inject(DOCUMENT).body.appendChild(this.host.nativeElement);
  }

  ngOnInit(): void {
    this.selected.set([...this.row.selected]);
  }

  ngOnDestroy(): void {
    this.host.nativeElement.remove();
  }

  /** Color elegido para la respuesta al preparar la junta; `null` = el de por defecto (según `tone`). */
  customColor(index: number): string | null {
    return customOptionColor(this.question, index);
  }

  tone(index: number): Tone {
    return choiceTone(index, this.question.type);
  }

  isSelected(index: number): boolean {
    return this.selected().includes(index);
  }

  pick(index: number): void {
    if (this.busy) return;
    if (!this.multiple()) return this.selected.set([index]);
    this.selected.update((current) =>
      current.includes(index) ? current.filter((value) => value !== index) : [...current, index].sort((a, b) => a - b),
    );
  }

  submit(): void {
    const selected = this.selected();
    if (!selected.length || this.busy) return;
    this.confirm.emit(this.multiple() ? { optionIndexes: selected } : { optionIndex: selected[0] });
  }

  close(): void {
    if (!this.busy) this.closed.emit();
  }
}
