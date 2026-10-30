import { ChangeDetectionStrategy, Component, ElementRef, inject, input, output, signal } from '@angular/core';
import { IconComponent } from '../icon/icon.component';

/** Una fila de la lista: una opción o el encabezado de un `<optgroup>`. */
export interface SelectPanelItem {
  /** Posición de la opción dentro de `select.options`; -1 en los encabezados de grupo. */
  index: number;
  label: string;
  disabled: boolean;
  selected: boolean;
  group: boolean;
}

/**
 * Lista flotante de `SelectDropdownDirective`. Se monta en el `<body>` con posición fija para que
 * no la recorte ningún modal, cajón o tabla con `overflow`. No gestiona el teclado: el foco se queda
 * en el `<select>` y la directiva mueve `activeIndex`.
 */
@Component({
  selector: 'app-select-panel',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './select-panel.component.html',
  styleUrl: './select-panel.component.scss',
  host: {
    role: 'listbox',
    '[id]': 'listId()',
    '[attr.aria-label]': 'ariaLabel() || null',
    '(mousedown)': '$event.preventDefault()',
  },
})
export class SelectPanelComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  readonly listId = input.required<string>();
  readonly ariaLabel = input('');
  readonly items = input.required<SelectPanelItem[]>();
  readonly anchor = input.required<HTMLElement>();

  /** Posición (en `items`) de la fila resaltada con teclado o ratón. */
  readonly activeIndex = signal(-1);
  readonly chosen = output<number>();

  optionId(position: number): string {
    return `${this.listId()}-opt-${position}`;
  }

  choose(item: SelectPanelItem): void {
    if (!item.group && !item.disabled) this.chosen.emit(item.index);
  }

  hover(position: number, item: SelectPanelItem): void {
    if (!item.group && !item.disabled) this.activeIndex.set(position);
  }

  scrollActiveIntoView(): void {
    this.host.ownerDocument.getElementById(this.optionId(this.activeIndex()))?.scrollIntoView?.({ block: 'nearest' });
  }

  /** Coloca la lista bajo el campo (o encima si abajo no cabe) sin salirse de la ventana. */
  reposition(): void {
    const margin = 8;
    const gap = 4;
    const maxHeight = 280;
    const rect = this.anchor().getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const style = this.host.style;

    style.minWidth = `${Math.round(rect.width)}px`;
    style.maxWidth = `${Math.max(rect.width, Math.min(360, viewportWidth - margin * 2))}px`;

    const below = viewportHeight - rect.bottom - margin - gap;
    const above = rect.top - margin - gap;
    const wanted = Math.min(maxHeight, this.host.scrollHeight);
    const openUp = below < wanted && above > below;
    const room = Math.max(96, openUp ? above : below);
    style.maxHeight = `${Math.min(maxHeight, room)}px`;

    const width = this.host.offsetWidth;
    style.left = `${Math.round(Math.min(Math.max(rect.left, margin), Math.max(margin, viewportWidth - width - margin)))}px`;
    if (openUp) {
      style.top = 'auto';
      style.bottom = `${Math.round(viewportHeight - rect.top + gap)}px`;
      style.transformOrigin = 'bottom';
    } else {
      style.bottom = 'auto';
      style.top = `${Math.round(rect.bottom + gap)}px`;
      style.transformOrigin = 'top';
    }
  }
}
