import { Component, ElementRef, OnInit, afterNextRender, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BtnComponent } from '../../../shared/components/btn/btn.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import {
  EstateGovernanceService, currentOffices, localDay, sameHolder,
  type AppointableOfficeRole, type CurrentOffice, type EstateOfficeTerm, type OfficeHolder,
} from '../../../core/estate-governance.service';

export type OfficeTermDialogMode =
  | { kind: 'appoint'; role: AppointableOfficeRole }
  | { kind: 'end'; office: CurrentOffice };

const DAY = new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
const formatDay = (day: string) => DAY.format(new Date(`${day.slice(0, 10)}T00:00:00Z`));
const lower = (label: string) => label.charAt(0).toLowerCase() + label.slice(1);
const nextDay = (day: string) => {
  const date = new Date(`${day.slice(0, 10)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};

/** Appoints a president or vice-president from a property's owners, or ends an office, warning about side effects. */
@Component({
  selector: 'app-office-term-dialog',
  standalone: true,
  imports: [FormsModule, BtnComponent, IconComponent],
  templateUrl: './office-term-dialog.component.html',
  styleUrl: './office-term-dialog.component.scss',
  host: { '(document:keydown.escape)': 'close()' },
})
export class OfficeTermDialogComponent implements OnInit {
  readonly estateId = input.required<string>();
  readonly propertyId = input.required<string>();
  readonly propertyLabel = input.required<string>();
  readonly mode = input.required<OfficeTermDialogMode>();
  /** Every office term of the estate: warnings are computed against them. */
  readonly terms = input<EstateOfficeTerm[]>([]);
  readonly saved = output<void>();
  readonly closed = output<void>();

  private readonly governance = inject(EstateGovernanceService);
  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');

  /** null = still loading the owners of the property. */
  readonly holders = signal<OfficeHolder[] | null>(null);
  readonly holderIndex = signal(0);
  readonly day = signal(localDay());
  readonly saving = signal(false);
  readonly error = signal('');

  readonly isAppoint = computed(() => this.mode().kind === 'appoint');
  readonly roleLabel = computed(() => {
    const mode = this.mode();
    if (mode.kind === 'end') return lower(mode.office.label);
    return mode.role === 'PRESIDENT' ? 'presidente' : 'vicepresidente';
  });
  readonly title = computed(() => (this.isAppoint() ? 'Nombrar ' : 'Cesar como ') + this.roleLabel());
  readonly submitLabel = computed(() => (this.isAppoint() ? 'Nombrar ' + this.roleLabel() : 'Cesar'));

  readonly holder = computed<OfficeHolder | null>(() => {
    const mode = this.mode();
    if (mode.kind === 'end') {
      const term = mode.office.term;
      return { userId: term.userId, externalOwnerId: term.externalOwnerId, name: term.holderNameSnapshot };
    }
    return this.holders()?.[this.holderIndex()] ?? null;
  });
  readonly minDay = computed(() => {
    const mode = this.mode();
    return mode.kind === 'end' ? nextDay(mode.office.term.startsAt) : '';
  });

  private readonly offices = computed(() => currentOffices(this.terms(), this.day() || localDay()));
  /** The office the chosen person already holds on the chosen date, if any. */
  private readonly heldOffice = computed(() => {
    const holder = this.holder();
    if (!holder) return null;
    const { president, vicePresidents } = this.offices();
    return [president, ...vicePresidents].find(office => office && sameHolder(office.term, holder)) ?? null;
  });

  /** A second office for the same person is refused (LPH art. 13), except a vice-president moving up. */
  private readonly holderBlocker = computed(() => {
    const mode = this.mode();
    const held = this.heldOffice();
    const holder = this.holder();
    if (mode.kind !== 'appoint' || !held || !holder) return '';
    if (held.term.role === 'VICE_PRESIDENT' && mode.role === 'PRESIDENT') return '';
    return `${holder.name} ya es ${lower(held.label)} de la comunidad.`;
  });
  /** A term cannot end the same day it started: the server refuses it, so the dialog says so first. */
  private readonly sameDayBlocker = computed(() => {
    const mode = this.mode();
    const holder = this.holder();
    const day = this.day();
    if (mode.kind !== 'appoint' || mode.role !== 'PRESIDENT' || !holder || !day) return '';
    const president = this.offices().president;
    if (president && !sameHolder(president.term, holder) && president.term.startsAt.slice(0, 10) === day) {
      return `El mandato de ${president.term.holderNameSnapshot} empieza el ${formatDay(day)}. Elige una fecha posterior.`;
    }
    const held = this.heldOffice();
    if (held && held.term.startsAt.slice(0, 10) === day) {
      return `La vicepresidencia de ${holder.name} empieza el ${formatDay(day)}. Elige una fecha posterior.`;
    }
    return '';
  });
  readonly blocker = computed(() => this.holderBlocker() || this.sameDayBlocker());

  readonly warnings = computed<string[]>(() => {
    const mode = this.mode();
    const holder = this.holder();
    const day = this.day();
    if (!holder || !day || this.blocker()) return [];
    const { president, vicePresidents } = this.offices();
    const when = formatDay(day);
    const followersMoveUp = (term: EstateOfficeTerm) =>
      vicePresidents.findIndex(office => office.term.id === term.id) < vicePresidents.length - 1
        ? ['Los vicepresidentes que van detrás suben un puesto.'] : [];

    if (mode.kind === 'end') {
      const term = mode.office.term;
      if (term.role === 'PRESIDENT') return [`${holder.name} dejará de ser presidente el ${when}. La comunidad quedará sin presidente hasta que nombres a otro.`];
      return [`${holder.name} dejará de ser ${lower(mode.office.label)} el ${when}.`, ...followersMoveUp(term)];
    }
    if (mode.role === 'VICE_PRESIDENT') {
      return [`${holder.name} será vicepresidente ${vicePresidents.length + 1}º. Los demás vicepresidentes siguen en el cargo.`];
    }
    const out: string[] = [];
    if (president && !sameHolder(president.term, holder)) {
      const ref = president.term.propertyReference ? ` (${president.term.propertyReference})` : '';
      out.push(`${president.term.holderNameSnapshot}${ref} es presidente desde el ${formatDay(president.term.startsAt)}. Al nombrar a ${holder.name}, su mandato terminará el ${when}.`);
    }
    const held = this.heldOffice();
    if (held) out.push(`${holder.name} dejará de ser ${lower(held.label)} el ${when}.`, ...followersMoveUp(held.term));
    return out;
  });

  readonly canSubmit = computed(() =>
    !this.saving() && !!this.holder() && !!this.day() && !this.blocker() && (!this.minDay() || this.day() >= this.minDay()));

  constructor() {
    afterNextRender(() => this.dialog()?.nativeElement.querySelector<HTMLElement>('input, button.close-btn')?.focus());
  }

  async ngOnInit(): Promise<void> {
    if (!this.isAppoint()) return;
    try {
      const properties = await this.governance.candidates(this.estateId());
      this.holders.set(properties.find(p => p.id === this.propertyId())?.holders ?? []);
    } catch {
      this.holders.set([]);
      this.error.set('No se pudieron cargar los titulares de la propiedad. Cierra y vuelve a intentarlo.');
    }
  }

  close(): void {
    if (!this.saving()) this.closed.emit();
  }

  async submit(): Promise<void> {
    const mode = this.mode();
    const holder = this.holder();
    if (!this.canSubmit() || !holder) return;
    this.saving.set(true);
    this.error.set('');
    try {
      if (mode.kind === 'end') {
        await this.governance.end(this.estateId(), mode.office.term.id, this.day());
      } else {
        await this.governance.appoint(this.estateId(), {
          role: mode.role, startsAt: this.day(), propertyId: this.propertyId(),
          userId: holder.userId ?? undefined, externalOwnerId: holder.externalOwnerId ?? undefined,
        });
      }
      this.saved.emit();
    } catch (error: any) {
      const message = error?.error?.message;
      this.error.set(typeof message === 'string' ? message : 'No se pudo guardar el cargo. Vuelve a intentarlo.');
    } finally {
      this.saving.set(false);
    }
  }
}
