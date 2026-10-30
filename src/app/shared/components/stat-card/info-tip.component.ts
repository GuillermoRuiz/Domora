import { Component, Input, signal } from '@angular/core';

let nextId = 0;

/**
 * «i» button that explains a figure. Opens on hover, on keyboard focus and
 * on tap/click (touch screens have no hover); closes on leaving, blur, a
 * second tap or Escape. A tap also fires focus and emulated mouse events
 * before its click, so the click decides from the state at pointerdown.
 * The bubble is a `role="tooltip"` the button points to with
 * `aria-describedby`.
 */
@Component({
  selector: 'app-info-tip',
  standalone: true,
  template: `
    <span class="info-tip">
      <button
        type="button"
        class="info-tip__button"
        [attr.aria-label]="label"
        [attr.aria-expanded]="open()"
        [attr.aria-describedby]="open() ? id : null"
        (mouseenter)="open.set(true)"
        (mouseleave)="open.set(false)"
        (focus)="open.set(true)"
        (blur)="open.set(false)"
        (pointerdown)="pointerDown($event)"
        (click)="clicked()"
        (keydown.escape)="open.set(false)"
      >i</button>
      @if (open()) {
        <span class="info-tip__bubble" role="tooltip" [id]="id">{{ text }}</span>
      }
    </span>
  `,
  styles: [`
    :host { display: inline-flex; }
    .info-tip { position: relative; display: inline-flex; }
    .info-tip__button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      padding: 0;
      font-family: inherit;
      font-size: 12px;
      font-style: italic;
      font-weight: 700;
      line-height: 1;
      color: var(--color-muted);
      background: none;
      border: 1px solid var(--color-border);
      border-radius: 50%;
      cursor: help;
    }
    .info-tip__button:hover { color: var(--color-text); }
    .info-tip__button:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
    .info-tip__bubble {
      position: absolute;
      top: calc(100% + 6px);
      right: -8px;
      z-index: 5;
      width: max-content;
      max-width: min(280px, 80vw);
      padding: 10px 12px;
      font-size: 13px;
      font-style: normal;
      font-weight: 400;
      line-height: 1.45;
      text-align: left;
      white-space: normal;
      color: var(--color-text);
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      box-shadow: var(--shadow-md);
    }
  `],
})
export class InfoTipComponent {
  @Input() text = '';
  /** Accessible name of the button. */
  @Input() label = 'Más información';

  readonly id = `info-tip-${++nextId}`;
  readonly open = signal(false);

  private pointer: { type: string; wasOpen: boolean } | null = null;

  pointerDown(event: PointerEvent): void {
    this.pointer = { type: event.pointerType, wasOpen: this.open() };
  }

  /** Mouse: hover already opened it, a click keeps it open. Touch/pen: toggles from before the tap. Keyboard (Enter/Space): toggles. */
  clicked(): void {
    const pointer = this.pointer;
    this.pointer = null;
    if (pointer?.type === 'mouse') this.open.set(true);
    else if (pointer) this.open.set(!pointer.wasOpen);
    else this.open.update(open => !open);
  }
}
