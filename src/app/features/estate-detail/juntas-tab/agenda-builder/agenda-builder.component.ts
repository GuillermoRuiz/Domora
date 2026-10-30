import { Component, ElementRef, EventEmitter, HostListener, Injector, Input, OnDestroy, Output, afterNextRender, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BtnComponent } from '../../../../shared/components/btn/btn.component';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import { AgendaItem, VoteMajorityType, VoteQuestion } from '../../../../core/models';
import { MAJORITY_TYPE_OPTIONS } from '../meeting-detail/majority-type-suggester.util';
import { VOTE_OPTION_PALETTE, customOptionColor, optionColor } from '../../../../shared/vote-option-colors';

import { SelectDropdownDirective } from '../../../../shared/components/dropdown/select-dropdown.directive';
import { ordinaryAgendaKey } from '../../../../core/ordinary-agenda';
import type { MeetingType } from '../../../../core/models';
/** Copia del conjunto con `key` añadida o quitada. */
function toggled(set: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(set);
  if (!next.delete(key)) next.add(key);
  return next;
}

let nextId = 0;
function newItemId(): string {
  return `agenda-${Date.now()}-${nextId++}`;
}

function emptyQuestion(): VoteQuestion {
  return { title: '', type: 'single_choice', options: ['', ''], majorityType: 'mayoriaSimple' };
}

/** Punto de orden del día en blanco — también lo usa el wizard para sembrar el primer punto. */
export function newAgendaItem(): AgendaItem {
  return { id: newItemId(), title: '', description: '', hasVote: false };
}

/**
 * Orden del día de una junta: lista de puntos, cada uno con una plantilla
 * de votación opcional. Solo CAPTURA datos (title/type/options por
 * pregunta) — no ejecuta ninguna votación real. Integrar esto con un panel
 * de votación en directo (`vote_sessions`) es una historia aparte, fuera de
 * alcance de la videollamada.
 */
@Component({
  selector: 'app-agenda-builder',
  standalone: true,
  imports: [FormsModule, BtnComponent, IconComponent, SelectDropdownDirective],
  templateUrl: './agenda-builder.component.html',
  styleUrl: './agenda-builder.component.scss',
})
export class AgendaBuilderComponent implements OnDestroy {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private stopDrag: (() => void) | null = null;

  /** Resalta los puntos sin título (lo activa el wizard cuando la validación falla en este paso). */
  @Input() showErrors = false;
  @Input() meetingType: MeetingType = 'extraordinaria';
  readonly removalWarning = signal('');

  readonly majorityOptions = MAJORITY_TYPE_OPTIONS;
  readonly palette = VOTE_OPTION_PALETTE;
  /** Respuesta cuya paleta de colores está abierta. */
  readonly colorPicker = signal<{ itemId: string; question: number; option: number } | null>(null);
  readonly draggingId = signal<string | null>(null);
  /** Anuncio para lectores de pantalla al reordenar. */
  readonly liveMessage = signal('');

  private readonly itemsSignal = signal<AgendaItem[]>([newAgendaItem()]);

  /** Puntos y preguntas plegados con el chevron (solo vista: no viaja en el borrador). */
  private readonly collapsedItems = signal<ReadonlySet<string>>(new Set());
  private readonly collapsedQuestions = signal<ReadonlySet<string>>(new Set());

  @Input()
  set items(value: AgendaItem[] | null | undefined) {
    this.itemsSignal.set(value && value.length > 0 ? value : [newAgendaItem()]);
  }
  get items(): AgendaItem[] {
    return this.itemsSignal();
  }

  @Output() itemsChange = new EventEmitter<AgendaItem[]>();

  private emit(): void {
    this.itemsChange.emit(this.itemsSignal());
  }

  ngOnDestroy(): void {
    this.stopDrag?.();
  }

  addItem(): void {
    const item = newAgendaItem();
    this.itemsSignal.set([...this.itemsSignal(), item]);
    this.emit();
    this.focusAfterRender(`[data-title-for="${item.id}"]`);
  }

  /** Mueve un punto de `from` a `to` (índices) conservando todos sus datos; la numeración es la posición. */
  move(from: number, to: number): void {
    const items = this.itemsSignal();
    if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    this.itemsSignal.set(next);
    this.emit();
    this.liveMessage.set(`Punto movido a la posición ${to + 1} de ${next.length}.`);
  }

  /** Arrastre con pointer events (ratón y táctil) desde el asa; no depende de HTML5 DnD ni de CDK. */
  startDrag(event: PointerEvent, id: string): void {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    this.stopDrag?.();
    this.draggingId.set(id);
    const onMove = (e: PointerEvent) => this.dragTo(e.clientY, id);
    const end = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', end);
      document.removeEventListener('pointercancel', end);
      this.draggingId.set(null);
      this.stopDrag = null;
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', end);
    document.addEventListener('pointercancel', end);
    this.stopDrag = end;
  }

  private dragTo(clientY: number, id: string): void {
    const cards = Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>('[data-agenda-id]'));
    const from = this.itemsSignal().findIndex((i) => i.id === id);
    if (from < 0) return;
    // Posición de inserción = nº de OTRAS tarjetas cuyo punto medio queda por encima del puntero.
    const to = cards.filter((c) => c.dataset['agendaId'] !== id).filter((c) => {
      const r = c.getBoundingClientRect();
      return clientY > r.top + r.height / 2;
    }).length;
    this.move(from, to);
  }

  /** Teclado: flechas arriba/abajo sobre el asa reordenan; el foco se conserva en el asa. */
  onHandleKeydown(event: KeyboardEvent, id: string): void {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const index = this.itemsSignal().findIndex((i) => i.id === id);
    this.move(index, index + (event.key === 'ArrowUp' ? -1 : 1));
    this.focusAfterRender(`[data-handle-for="${id}"]`);
  }

  private focusAfterRender(selector: string): void {
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus(), { injector: this.injector });
  }

  removeItem(id: string): void {
    const item = this.itemsSignal().find(item => item.id === id);
    const key = item && ordinaryAgendaKey(item);
    if (this.meetingType === 'ordinaria' && (key === 'annual_accounts_approval' || key === 'annual_budget_approval')) {
      this.removalWarning.set('Las cuentas y el presupuesto forman parte del contenido propio de la Junta Ordinaria anual. Este punto no se puede eliminar mientras la junta sea Ordinaria.');
      // El aviso está sobre la lista: si el punto está más abajo, en móvil quedaría fuera de la vista.
      afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>('[role="alert"]')?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }), { injector: this.injector });
      return;
    }
    this.removalWarning.set('');
    // Siempre queda al menos un punto — igual que el original al abrir el modal.
    if (this.itemsSignal().length <= 1) return;
    this.itemsSignal.set(this.itemsSignal().filter((i) => i.id !== id));
    this.emit();
  }

  updateTitle(id: string, title: string): void {
    this.patch(id, { title });
  }

  updateDescription(id: string, description: string): void {
    this.patch(id, { description });
  }

  isItemOpen(id: string): boolean {
    return !this.collapsedItems().has(id);
  }

  toggleItem(id: string): void {
    this.collapsedItems.update((set) => toggled(set, id));
  }

  isQuestionOpen(itemId: string, index: number): boolean {
    return !this.collapsedQuestions().has(`${itemId}:${index}`);
  }

  toggleQuestion(itemId: string, index: number): void {
    this.collapsedQuestions.update((set) => toggled(set, `${itemId}:${index}`));
  }

  /** Quita los pliegues de las preguntas de un punto (sus índices dejan de ser válidos). */
  private resetQuestionFolds(itemId: string): void {
    this.collapsedQuestions.update((set) => new Set([...set].filter((key) => !key.startsWith(`${itemId}:`))));
  }

  toggleVote(id: string, hasVote: boolean): void {
    this.resetQuestionFolds(id);
    this.patch(id, {
      hasVote,
      voteTemplate: hasVote ? { questions: [emptyQuestion()] } : undefined,
    });
  }

  private patch(id: string, changes: Partial<AgendaItem>): void {
    this.itemsSignal.set(
      this.itemsSignal().map((i) => (i.id === id ? { ...i, ...changes } : i)),
    );
    this.emit();
  }

  addQuestion(itemId: string): void {
    this.patchVote(itemId, (questions) => [...questions, emptyQuestion()]);
  }

  removeQuestion(itemId: string, index: number): void {
    // Las preguntas posteriores suben un índice: su pliegue las acompaña.
    this.collapsedQuestions.update((set) => {
      const next = new Set<string>();
      for (const key of set) {
        const [id, i] = [key.slice(0, key.lastIndexOf(':')), Number(key.slice(key.lastIndexOf(':') + 1))];
        if (id !== itemId || i < index) next.add(key);
        else if (i > index) next.add(`${id}:${i - 1}`);
      }
      return next;
    });
    this.patchVote(itemId, (questions) =>
      questions.length <= 1 ? questions : questions.filter((_, i) => i !== index),
    );
  }

  updateQuestionTitle(itemId: string, index: number, title: string): void {
    this.patchVote(itemId, (questions) =>
      questions.map((q, i) => (i === index ? { ...q, title } : q)),
    );
  }

  updateQuestionType(itemId: string, index: number, type: VoteQuestion['type']): void {
    this.patchVote(itemId, (questions) =>
      questions.map((q, i) => {
        if (i !== index) return q;
        const needsOptions = type === 'single_choice' || type === 'multiple_choice';
        return {
          ...q,
          type,
          options: needsOptions ? (q.options?.length ? q.options : ['', '']) : undefined,
          optionColors: needsOptions ? q.optionColors : undefined,
          // Una pregunta de texto libre no se vota: no tiene mayoría.
          majorityType: needsOptions ? (q.majorityType ?? 'mayoriaSimple') : undefined,
        };
      }),
    );
  }

  updateQuestionMajority(itemId: string, index: number, majorityType: VoteMajorityType): void {
    this.patchVote(itemId, (questions) => questions.map((q, i) => (i === index ? { ...q, majorityType } : q)));
  }

  majorityLegend(type: VoteMajorityType | undefined): string {
    return MAJORITY_TYPE_OPTIONS.find((option) => option.value === type)?.legend ?? '';
  }

  addOption(itemId: string, questionIndex: number): void {
    this.patchVote(itemId, (questions) =>
      questions.map((q, i) =>
        i === questionIndex
          ? {
              ...q,
              options: [...(q.options ?? []), ''],
              ...(q.optionColors ? { optionColors: [...q.optionColors, ''] } : {}),
            }
          : q,
      ),
    );
  }

  removeOption(itemId: string, questionIndex: number, optionIndex: number): void {
    this.colorPicker.set(null);
    this.patchVote(itemId, (questions) =>
      questions.map((q, i) =>
        i === questionIndex
          ? {
              ...q,
              options: (q.options ?? []).filter((_, oi) => oi !== optionIndex),
              ...(q.optionColors ? { optionColors: q.optionColors.filter((_, oi) => oi !== optionIndex) } : {}),
            }
          : q,
      ),
    );
  }

  /** Color con el que verán la respuesta quienes voten (el elegido o el de por defecto). */
  colorOf(question: VoteQuestion, optionIndex: number): string {
    return optionColor(question, optionIndex);
  }

  isColorChosen(question: VoteQuestion, optionIndex: number, color: string): boolean {
    return customOptionColor(question, optionIndex)?.toLowerCase() === color.toLowerCase();
  }

  hasCustomColor(question: VoteQuestion, optionIndex: number): boolean {
    return customOptionColor(question, optionIndex) !== null;
  }

  isColorPickerOpen(itemId: string, questionIndex: number, optionIndex: number): boolean {
    const open = this.colorPicker();
    return open?.itemId === itemId && open.question === questionIndex && open.option === optionIndex;
  }

  toggleColorPicker(itemId: string, questionIndex: number, optionIndex: number): void {
    this.colorPicker.set(
      this.isColorPickerOpen(itemId, questionIndex, optionIndex)
        ? null
        : { itemId, question: questionIndex, option: optionIndex },
    );
  }

  /** Fija el color de una respuesta; `''` vuelve al de por defecto. */
  setOptionColor(itemId: string, questionIndex: number, optionIndex: number, color: string): void {
    this.colorPicker.set(null);
    this.patchVote(itemId, (questions) =>
      questions.map((q, i) => {
        if (i !== questionIndex) return q;
        const colors = (q.options ?? []).map((_, oi) => q.optionColors?.[oi] ?? '');
        colors[optionIndex] = color;
        return { ...q, optionColors: colors };
      }),
    );
  }

  @HostListener('document:click', ['$event'])
  closeColorPickerOnOutsideClick(event: Event): void {
    if (this.colorPicker() && !(event.target as HTMLElement).closest('.color-pick')) this.colorPicker.set(null);
  }

  @HostListener('keydown.escape', ['$event'])
  closeColorPickerOnEscape(event: Event): void {
    if (!this.colorPicker()) return;
    // Cierra solo la paleta; el Escape no debe llegar al modal.
    event.stopPropagation();
    this.colorPicker.set(null);
  }

  updateOption(itemId: string, questionIndex: number, optionIndex: number, value: string): void {
    this.patchVote(itemId, (questions) =>
      questions.map((q, i) =>
        i === questionIndex
          ? { ...q, options: (q.options ?? []).map((o, oi) => (oi === optionIndex ? value : o)) }
          : q,
      ),
    );
  }

  private patchVote(
    itemId: string,
    updater: (questions: VoteQuestion[]) => VoteQuestion[],
  ): void {
    this.itemsSignal.set(
      this.itemsSignal().map((i) => {
        if (i.id !== itemId || !i.voteTemplate) return i;
        return { ...i, voteTemplate: { questions: updater(i.voteTemplate.questions) } };
      }),
    );
    this.emit();
  }
}
