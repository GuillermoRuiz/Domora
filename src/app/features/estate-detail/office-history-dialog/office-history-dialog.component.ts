import { Component, ElementRef, OnInit, afterNextRender, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { EstateGovernanceService, currentOffices, localDay, type EstateOfficeTerm } from '../../../core/estate-governance.service';

const DAY = new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
const ROLE: Record<EstateOfficeTerm['role'], string> = { PRESIDENT: 'Presidente', VICE_PRESIDENT: 'Vicepresidente', SECRETARY: 'Secretario' };

/** Read-only history of the community's offices (president and vice-presidents), newest first. */
@Component({
  selector: 'app-office-history-dialog',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './office-history-dialog.component.html',
  styleUrl: './office-history-dialog.component.scss',
  host: { '(document:keydown.escape)': 'closed.emit()' },
})
export class OfficeHistoryDialogComponent implements OnInit {
  readonly estateId = input.required<string>();
  readonly estateName = input('');
  readonly closed = output<void>();

  private readonly governance = inject(EstateGovernanceService);
  private readonly closeButton = viewChild<ElementRef<HTMLButtonElement>>('closeButton');

  /** null = loading. */
  readonly terms = signal<EstateOfficeTerm[] | null>(null);
  readonly error = signal(false);

  readonly rows = computed(() => {
    const terms = this.terms() ?? [];
    const { president, vicePresidents } = currentOffices(terms, localDay());
    const liveLabel = new Map([president, ...vicePresidents].flatMap(o => (o ? [[o.term.id, o.label] as const] : [])));
    return [...terms]
      .sort((a, b) => b.startsAt.localeCompare(a.startsAt) || (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
      .map(term => ({
        id: term.id,
        role: liveLabel.get(term.id) ?? ROLE[term.role],
        holder: term.holderNameSnapshot,
        property: term.propertyReference ?? '—',
        from: DAY.format(new Date(`${term.startsAt.slice(0, 10)}T00:00:00Z`)),
        to: term.endsAt ? DAY.format(new Date(`${term.endsAt.slice(0, 10)}T00:00:00Z`)) : null,
        live: liveLabel.has(term.id),
      }));
  });

  constructor() {
    afterNextRender(() => this.closeButton()?.nativeElement.focus());
  }

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  async load(): Promise<void> {
    this.error.set(false);
    this.terms.set(null);
    try {
      this.terms.set(await this.governance.list(this.estateId()));
    } catch {
      this.error.set(true);
      this.terms.set([]);
    }
  }
}
