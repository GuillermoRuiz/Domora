import { Component, input } from '@angular/core';

/** One step of an issue's follow-up, as both the manager and the owner views receive it. */
export interface TimelineItem {
  id?: string;
  /** ISO date-time. */
  date: string;
  author: string;
  role: string;
  text: string;
  fromStatus?: string | null;
  toStatus?: string | null;
}

/** Trailing hollow node: what happens next while the issue is still open. */
export interface TimelinePending {
  title: string;
  text: string;
}

const WHEN = new Intl.DateTimeFormat('es-ES', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'Europe/Madrid',
});

/**
 * Vertical follow-up of an issue («Seguimiento»): one node per entry, oldest
 * first, with author, role, date, text and the status change when there is
 * one. Presentational: the caller decides the status labels and whether a
 * pending node closes the list.
 */
@Component({
  selector: 'app-issue-timeline',
  standalone: true,
  template: `
    <ol class="timeline" aria-label="Seguimiento">
      @for (entry of entries(); track entry.id ?? $index) {
        <li class="timeline__item" data-entry>
          <span class="timeline__node" [class]="'timeline__node timeline__node--' + roleClass(entry.role)" aria-hidden="true"></span>
          <div class="timeline__body">
            <div class="timeline__head">
              <strong data-author>{{ entry.author }}</strong>
              <span class="timeline__role">{{ entry.role }}</span>
              <time [attr.datetime]="entry.date">{{ format(entry.date) }}</time>
            </div>
            @if (entry.fromStatus && entry.toStatus && entry.fromStatus !== entry.toStatus) {
              <div class="timeline__status" data-status-change>{{ statusLabel()(entry.fromStatus) }} → {{ statusLabel()(entry.toStatus) }}</div>
            }
            @if (entry.text) {
              <p class="timeline__text">{{ entry.text }}</p>
            }
          </div>
        </li>
      }
      @if (pending(); as p) {
        <li class="timeline__item timeline__item--pending" data-pending>
          <span class="timeline__node timeline__node--pending" aria-hidden="true"></span>
          <div class="timeline__body">
            <div class="timeline__head"><strong>{{ p.title }}</strong></div>
            <p class="timeline__text">{{ p.text }}</p>
          </div>
        </li>
      }
    </ol>
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .timeline { position: relative; margin: 0; padding: 0; list-style: none; }
    .timeline__item { position: relative; display: grid; grid-template-columns: 14px minmax(0, 1fr); gap: 12px; padding-bottom: 16px; }
    .timeline__item:last-child { padding-bottom: 0; }
    /* Connector between nodes. */
    .timeline__item:not(:last-child)::before {
      content: '';
      position: absolute;
      top: 16px;
      bottom: 0;
      left: 6px;
      width: 2px;
      background: var(--color-border);
    }
    .timeline__node { width: 14px; height: 14px; margin-top: 3px; border-radius: 50%; background: var(--color-muted); box-shadow: 0 0 0 3px var(--color-surface); }
    .timeline__node--owner { background: var(--color-accent); }
    .timeline__node--manager { background: var(--color-blue); }
    .timeline__node--system { background: var(--color-muted); }
    .timeline__node--pending { background: var(--color-surface); border: 2px dashed var(--color-border); }
    .timeline__body { min-width: 0; }
    .timeline__head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 8px; font-size: 13.5px; color: var(--color-text); }
    .timeline__role { padding: 1px 6px; font-size: 11.5px; color: var(--color-muted); background: var(--color-border-light); border-radius: 4px; }
    .timeline__head time { margin-left: auto; font-size: 12px; color: var(--color-muted); white-space: nowrap; }
    .timeline__status { margin-top: 3px; font-size: 12.5px; font-weight: 600; color: var(--color-muted); }
    .timeline__text { margin: 4px 0 0; font-size: 13.5px; line-height: 1.5; color: var(--color-muted); white-space: pre-line; overflow-wrap: anywhere; }
    .timeline__item--pending .timeline__head strong { color: var(--color-muted); font-weight: 600; }
  `],
})
export class IssueTimelineComponent {
  readonly entries = input<TimelineItem[]>([]);
  readonly pending = input<TimelinePending | null>(null);
  /** Display label of a status value (identity by default). */
  readonly statusLabel = input<(status: string) => string>((status) => status);

  format(iso: string): string {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? iso : WHEN.format(date);
  }

  roleClass(role: string): string {
    if (role === 'Propietario') return 'owner';
    if (role === 'Administrador') return 'manager';
    return 'system';
  }
}
