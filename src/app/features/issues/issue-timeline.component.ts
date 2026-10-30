import { Component, computed, input } from '@angular/core';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { IssueTimelineEntry } from '../../core/models';
import { presentTimeline, TimelineTone } from './issue-timeline.util';

const TONE_LABEL: Record<TimelineTone, string> = {
  person: 'Persona',
  domora: 'Domora',
  third: 'Tercero',
  status: 'Estado',
  communication: 'Comunicación',
};

/** Cronología única del expediente: una sola lista, con un matiz ligero según quién actúa y de qué se trata. */
@Component({
  selector: 'app-issue-timeline',
  standalone: true,
  imports: [IconComponent],
  template: `
    @if (items().length === 0) {
      <p class="tl-empty">Todavía no hay nada en el historial.</p>
    } @else {
      <ol class="tl">
        @for (item of items(); track item.key) {
          <li class="tl__item" [attr.data-tone]="item.tone">
            <span class="tl__dot" [class]="'tl__dot--' + item.tone" [attr.title]="toneLabel(item.tone)"><app-icon [name]="item.icon" [size]="13"></app-icon></span>
            <div class="tl__body">
              <div class="tl__head">
                <strong class="tl__author">{{ item.author }}</strong>
                @if (item.lead) { <span class="tl__lead">{{ item.lead }}</span> }
                <time class="tl__date" [attr.datetime]="item.iso">{{ item.date }}</time>
              </div>
              @if (item.detail) { <div class="tl__detail">{{ item.detail }}</div> }
              <div class="tl__text">{{ item.text }}</div>
            </div>
          </li>
        }
      </ol>
    }
  `,
  styles: `
    .tl-empty { margin: 0; font-size: 14px; color: var(--color-light); }
    .tl { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
    .tl__item { display: flex; gap: 12px; position: relative; padding-bottom: 14px; }
    .tl__item:not(:last-child)::before { content: ''; position: absolute; left: 13px; top: 28px; bottom: 0; width: 1px; background: var(--color-border-light); }
    .tl__dot { width: 27px; height: 27px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; background: var(--color-border-light); color: var(--color-muted); z-index: 1; }
    .tl__dot--person { background: var(--color-secondary-bg); color: var(--color-secondary); }
    .tl__dot--domora { background: var(--color-blue-bg); color: var(--color-blue); }
    .tl__dot--third { background: var(--color-purple-bg); color: var(--color-purple); }
    .tl__dot--status { background: var(--color-warning-bg); color: var(--color-warning); }
    .tl__dot--communication { background: var(--color-orange-bg); color: var(--color-orange); }
    .tl__body { flex: 1; min-width: 0; }
    .tl__head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; font-size: 13px; }
    .tl__author { font-weight: 600; color: var(--color-text); }
    .tl__lead { font-size: 11.5px; color: var(--color-muted); background: var(--color-border-light); border-radius: 4px; padding: 1px 6px; }
    .tl__date { margin-left: auto; font-size: 12px; color: var(--color-light); }
    .tl__detail { font-size: 12.5px; color: var(--color-muted); margin-top: 1px; }
    .tl__text { font-size: 14px; color: var(--color-text); line-height: 1.5; margin-top: 2px; overflow-wrap: anywhere; }
  `,
})
export class IssueTimelineComponent {
  readonly entries = input.required<readonly IssueTimelineEntry[]>();
  readonly items = computed(() => presentTimeline(this.entries()));
  toneLabel(tone: TimelineTone): string {
    return TONE_LABEL[tone];
  }
}
