import { AfterViewInit, Component, DestroyRef, ElementRef, OnInit, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import {
  OWNER_ISSUE_STATUS,
  OWNER_ISSUE_SUBTYPES,
  type CreateOwnerIssueInput,
  type OwnerIssueLocation,
  type OwnerIssueSubtype,
  type SimilarIssue,
} from '../../../core/owner-issues.models';
import { OwnerIssuesService } from '../../../core/owner-issues.service';
import { SelectDropdownDirective } from '../../../shared/components/dropdown/select-dropdown.directive';
import { BtnComponent } from '../../../shared/components/btn/btn.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { IssuePhotoPickerComponent } from '../../issues/issue-photo-picker/issue-photo-picker.component';
import { ISSUE_TITLE_MAX, messageFrom, responseTime } from '../issue-helpers';

/** What the page needs after creating: the new issue and the files that could not be uploaded. */
export interface IssueCreated {
  id: string;
  failedUploads: string[];
}

/** Una comunidad en la que se puede avisar. */
export interface IssueCommunity {
  id: string;
  name: string;
}

interface Draft {
  estateId: string;
  subtype: OwnerIssueSubtype | '';
  title: string;
  description: string;
  location: string;
  otherLocation: string;
  urgent: boolean | null;
}

/** Value of the «Otra…» location option. */
export const OTHER_LOCATION = '__other__';
const SIMILAR_DELAY_MS = 300;
const draftKey = (userId: string) => `domora.issueDraft.${userId}`;
/** A word the server can match (it ignores words shorter than 4 letters). */
const hasSearchableWord = (text: string) => text.split(/[^\p{L}\p{N}]+/u).some((w) => w.length >= 4);

/**
 * «Nueva incidencia» para propietarios: comunidad (cuando la página muestra «Todas»), tipo de incidencia, asunto,
 * descripción, zona o instalación afectada, una pregunta guiada de urgencia y adjuntos. La incidencia es de la comunidad:
 * no se elige ninguna vivienda. Sugiere incidencias abiertas parecidas de la comunidad para que el vecino pueda decir
 * «Me afecta también» en vez de abrir un duplicado. Guarda un borrador por usuario mientras se escribe.
 */
const SUBTYPE_ICONS: Record<string, string> = {
  Averia: 'wrench',
  Ruido: 'bell',
  DanoEstructural: 'roof',
  Fuga: 'droplet',
  Seguridad: 'shield',
  Limpieza: 'sparkles',
  Otro: 'help-circle',
};

@Component({
  selector: 'app-new-issue-modal',
  standalone: true,
  imports: [BtnComponent, IconComponent, IssuePhotoPickerComponent, SelectDropdownDirective],
  templateUrl: './new-issue-modal.component.html',
  styleUrl: './new-issue-modal.component.scss',
})
export class NewIssueModalComponent implements OnInit, AfterViewInit {
  /** Las comunidades en las que puede avisar. */
  readonly communities = input<IssueCommunity[]>([]);
  /** Comunidad fija (la elegida en la página); null la pregunta. */
  readonly estateId = input<string | null>(null);
  readonly userId = input<string | null>(null);

  readonly closed = output<void>();
  readonly created = output<IssueCreated>();
  /** The owner chose «Me afecta también» on an existing issue instead of creating one. */
  readonly affected = output<string>();

  private api = inject(OwnerIssuesService);
  private dialog = viewChild<ElementRef<HTMLElement>>('dialog');

  readonly subtypes = OWNER_ISSUE_SUBTYPES;
  readonly maxTitle = ISSUE_TITLE_MAX;
  readonly statusInfo = OWNER_ISSUE_STATUS;
  readonly OTHER = OTHER_LOCATION;
  /** Lo que se promete a quien avisa de un riesgo (el mismo plazo que muestra la ficha de una urgente). */
  readonly urgentResponse = responseTime(24);

  readonly chosenEstate = signal('');
  readonly subtype = signal<OwnerIssueSubtype | ''>('');
  /** El icono del campo sigue al tipo elegido. */
  readonly subtypeIcon = computed(() => SUBTYPE_ICONS[this.subtype()] ?? 'wrench');
  readonly title = signal('');
  readonly description = signal('');
  readonly location = signal('');
  readonly otherLocation = signal('');
  readonly urgent = signal<boolean | null>(null);
  readonly files = signal<File[]>([]);
  readonly locationDetail = signal('');
  readonly showDetail = signal(false);
  readonly locations = signal<OwnerIssueLocation[]>([]);
  readonly locationsFailed = signal(false);
  readonly similar = signal<SimilarIssue[]>([]);
  readonly submitted = signal(false);
  readonly sending = signal(false);
  readonly formError = signal<string | null>(null);
  readonly draftRestored = signal(false);

  readonly targetEstateId = computed(() => this.estateId() ?? (this.chosenEstate() || null));
  readonly askEstate = computed(() => this.estateId() === null);
  readonly errors = computed(() => {
    const errors: Record<string, string> = {};
    if (!this.targetEstateId()) errors['estate'] = 'Elige la comunidad.';
    if (!this.title().trim()) errors['title'] = 'Cuéntanos qué ha pasado.';
    if (!this.description().trim()) errors['description'] = 'Describe lo que ocurre.';
    if (!this.location() || (this.location() === OTHER_LOCATION && !this.otherLocation().trim())) errors['location'] = 'Elige dónde ocurre.';
    if (this.urgent() === null) errors['urgent'] = 'Indica si hay riesgo o daños activos.';
    return errors;
  });

  private ready = false;
  private similarTimer: ReturnType<typeof setTimeout> | undefined;
  private similarSeq = 0;
  private locationsSeq = 0;

  constructor() {
    // Zonas e instalaciones de la comunidad en la que se avisa.
    effect(() => {
      const estateId = this.targetEstateId();
      untracked(() => void this.loadLocations(estateId));
    });
    // Incidencias abiertas parecidas de la comunidad mientras se escribe el asunto.
    effect(() => {
      const estateId = this.targetEstateId();
      const title = this.title().trim();
      untracked(() => {
        clearTimeout(this.similarTimer);
        this.similarSeq++;
        if (!estateId || !hasSearchableWord(title)) {
          this.similar.set([]);
          return;
        }
        this.similarTimer = setTimeout(() => void this.loadSimilar(estateId, title), SIMILAR_DELAY_MS);
      });
    });
    // Draft kept while writing.
    effect(() => {
      const draft = this.snapshot();
      if (this.ready) untracked(() => this.saveDraft(draft));
    });
    inject(DestroyRef).onDestroy(() => clearTimeout(this.similarTimer));
  }

  ngOnInit(): void {
    this.restoreDraft();
    this.ready = true;
  }

  ngAfterViewInit(): void {
    setTimeout(() => this.dialog()?.nativeElement.querySelector<HTMLElement>('[data-autofocus]')?.focus());
  }

  onEscape(event: Event): void {
    event.stopPropagation();
    this.close();
  }

  close(): void {
    this.closed.emit();
  }

  /** «Descartar»: forgets the draft. */
  discard(): void {
    clearTimeout(this.similarTimer);
    this.clearDraft();
    this.closed.emit();
  }

  value(event: Event): string {
    return (event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value;
  }

  chooseLocation(value: string): void {
    this.location.set(value);
  }

  async markAffected(issue: SimilarIssue): Promise<void> {
    this.formError.set(null);
    this.sending.set(true);
    try {
      if (!issue.affectedByMe) await this.api.setAffected(issue.id, true);
      clearTimeout(this.similarTimer);
      this.clearDraft();
      this.affected.emit(issue.id);
    } catch (error) {
      this.formError.set(messageFrom(error, 'No se pudo marcar la incidencia. Inténtalo de nuevo.'));
    } finally {
      this.sending.set(false);
    }
  }

  async submit(event?: Event): Promise<void> {
    event?.preventDefault();
    this.submitted.set(true);
    this.formError.set(null);
    const estateId = this.targetEstateId();
    if (Object.keys(this.errors()).length > 0 || !estateId || this.sending()) return;
    const other = this.location() === OTHER_LOCATION;
    const body: CreateOwnerIssueInput = {
      estateId,
      ...(this.subtype() ? { type: this.subtype() as OwnerIssueSubtype } : {}),
      title: this.title().trim(),
      description: this.description().trim(),
      location: other ? this.otherLocation().trim() : this.withDetail(this.location()),
      urgent: this.urgent() === true,
    };
    this.sending.set(true);
    try {
      const issue = await this.api.create(body);
      const failedUploads: string[] = [];
      for (const file of this.files()) {
        try {
          await this.api.uploadAttachment(issue.id, file);
        } catch {
          failedUploads.push(file.name);
        }
      }
      clearTimeout(this.similarTimer);
      this.clearDraft();
      this.created.emit({ id: issue.id, failedUploads });
    } catch (error) {
      this.formError.set(messageFrom(error, 'No se pudo enviar. Inténtalo de nuevo.'));
    } finally {
      this.sending.set(false);
    }
  }

  /** «Garaje · Rampa de entrada»: la zona elegida con el detalle que haya escrito, sin pasar de los 120 caracteres del servidor. */
  private withDetail(zone: string): string {
    const detail = this.locationDetail().trim();
    return (detail ? `${zone} · ${detail}` : zone).slice(0, 120);
  }

  private async loadLocations(estateId: string | null): Promise<void> {
    const seq = ++this.locationsSeq;
    this.locations.set([]);
    this.locationsFailed.set(false);
    if (!estateId) return;
    try {
      const locations = await this.api.locations(estateId);
      if (seq !== this.locationsSeq) return;
      this.locations.set(locations);
      const current = this.location();
      if (current && current !== OTHER_LOCATION && !locations.some((l) => l.label === current)) this.location.set('');
    } catch {
      if (seq === this.locationsSeq) this.locationsFailed.set(true);
    }
  }

  private async loadSimilar(estateId: string, title: string): Promise<void> {
    const seq = this.similarSeq;
    try {
      const similar = await this.api.similar(estateId, title);
      if (seq === this.similarSeq) this.similar.set(similar.slice(0, 5));
    } catch {
      // Suggestions are optional: without them the owner just creates the issue.
      if (seq === this.similarSeq) this.similar.set([]);
    }
  }

  private snapshot(): Draft {
    return {
      estateId: this.chosenEstate(),
      subtype: this.subtype(),
      title: this.title(),
      description: this.description(),
      location: this.location(),
      otherLocation: this.otherLocation(),
      urgent: this.urgent(),
    };
  }

  private saveDraft(draft: Draft): void {
    const userId = this.userId();
    if (!userId) return;
    const empty = !draft.title.trim() && !draft.description.trim() && !draft.otherLocation.trim();
    try {
      if (empty) localStorage.removeItem(draftKey(userId));
      else localStorage.setItem(draftKey(userId), JSON.stringify(draft));
    } catch {
      // Without storage the form simply is not remembered.
    }
  }

  private restoreDraft(): void {
    const userId = this.userId();
    if (!userId) return;
    let draft: Partial<Draft> | null = null;
    try {
      const raw = localStorage.getItem(draftKey(userId));
      draft = raw ? (JSON.parse(raw) as Partial<Draft>) : null;
    } catch {
      draft = null;
    }
    if (!draft || typeof draft !== 'object') return;
    if (draft.estateId && this.askEstate() && this.communities().some((c) => c.id === draft.estateId)) this.chosenEstate.set(draft.estateId);
    if (draft.subtype !== undefined && (draft.subtype === '' || OWNER_ISSUE_SUBTYPES.some((s) => s.value === draft.subtype))) this.subtype.set(draft.subtype);
    if (typeof draft.title === 'string') this.title.set(draft.title);
    if (typeof draft.description === 'string') this.description.set(draft.description);
    if (typeof draft.location === 'string') this.location.set(draft.location);
    if (typeof draft.otherLocation === 'string') this.otherLocation.set(draft.otherLocation);
    if (typeof draft.urgent === 'boolean') this.urgent.set(draft.urgent);
    this.draftRestored.set(!!(draft.title || draft.description));
  }

  private clearDraft(): void {
    const userId = this.userId();
    if (!userId) return;
    try {
      localStorage.removeItem(draftKey(userId));
    } catch {
      // Nothing stored.
    }
  }
}
