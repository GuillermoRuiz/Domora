import { Component, ElementRef, EventEmitter, Input, Output, computed, inject, signal } from '@angular/core';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import type { JuntaAttendee, JuntaOwner } from '../junta-draft.store';

let nextId = 0;

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
const AVATAR_TONES = ['blue', 'purple', 'orange', 'green'] as const;

interface PickerOption {
  kind: 'owner' | 'custom';
  email: string;
  name?: string;
  label: string;
}

/**
 * Asistentes como chips con búsqueda sobre los propietarios reales de la finca.
 * Mantiene la lógica anterior: precarga de propietarios (la hace el wizard) y
 * posibilidad de añadir cualquier otro email a mano; lo único que viaja al
 * backend siguen siendo los emails (`attendeeEmails`).
 */
@Component({
  selector: 'app-attendee-picker',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './attendee-picker.component.html',
  styleUrl: './attendee-picker.component.scss',
})
export class AttendeePickerComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly attendees = signal<JuntaAttendee[]>([]);
  readonly owners = signal<JuntaOwner[]>([]);

  @Input({ alias: 'attendees' }) set attendeesInput(value: JuntaAttendee[]) {
    this.attendees.set(value);
  }
  @Input({ alias: 'owners' }) set ownersInput(value: JuntaOwner[]) {
    this.owners.set(value);
  }
  @Input() loading = false;
  @Input() disabled = false;
  @Output() attendeesChange = new EventEmitter<JuntaAttendee[]>();

  readonly listId = `attendee-list-${++nextId}`;
  readonly query = signal('');
  readonly open = signal(false);
  readonly activeIndex = signal(0);
  readonly invalidEmail = signal(false);

  readonly options = computed<PickerOption[]>(() => {
    const q = this.query().trim().toLowerCase();
    const selected = new Set(this.attendees().map((a) => a.email.toLowerCase()));
    const owners: PickerOption[] = this.owners()
      .filter((o) => !selected.has(o.email.toLowerCase()))
      .filter((o) => !q || o.fullName.toLowerCase().includes(q) || o.email.toLowerCase().includes(q))
      .map((o) => ({ kind: 'owner', email: o.email, name: o.fullName, label: o.fullName || o.email }));
    const typed = this.query().trim();
    const knownOwner = this.owners().some((o) => o.email.toLowerCase() === typed.toLowerCase());
    if (EMAIL_RE.test(typed) && !selected.has(typed.toLowerCase()) && !knownOwner) {
      owners.push({ kind: 'custom', email: typed, label: `Añadir «${typed}»` });
    }
    return owners;
  });

  /** Todos los propietarios con email ya están entre los asistentes. */
  readonly allSelected = computed(() => {
    const selected = new Set(this.attendees().map((a) => a.email.toLowerCase()));
    return this.owners().every((o) => selected.has(o.email.toLowerCase()));
  });

  displayName(a: JuntaAttendee): string {
    return a.name?.trim() || a.email;
  }

  initials(a: JuntaAttendee): string {
    const source = a.name?.trim();
    if (source) {
      const parts = source.split(/\s+/).filter(Boolean);
      return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
    }
    return a.email.slice(0, 2).toUpperCase();
  }

  tone(a: JuntaAttendee): string {
    let hash = 0;
    for (const ch of a.email) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    return AVATAR_TONES[hash % AVATAR_TONES.length];
  }

  onInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    this.invalidEmail.set(false);
    this.activeIndex.set(0);
    this.open.set(true);
  }

  onKeydown(event: KeyboardEvent): void {
    const options = this.options();
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.open.set(true);
        this.activeIndex.set(options.length ? (this.activeIndex() + 1) % options.length : 0);
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.activeIndex.set(options.length ? (this.activeIndex() - 1 + options.length) % options.length : 0);
        break;
      case 'Enter':
      case ',':
      case ';': {
        const typed = this.query().trim();
        if (event.key !== 'Enter' && !typed) break;
        event.preventDefault();
        if (this.open() && options.length && (event.key === 'Enter' || !EMAIL_RE.test(typed))) {
          this.add(options[Math.min(this.activeIndex(), options.length - 1)]);
        } else if (typed) {
          this.addTyped();
        }
        break;
      }
      case 'Escape':
        if (this.open()) {
          // Cierra solo la lista; el Escape no debe llegar al modal.
          event.preventDefault();
          event.stopPropagation();
          this.open.set(false);
        }
        break;
    }
  }

  /** Pegar "a@x.com, b@y.com" añade todos los que sean emails válidos. */
  onPaste(event: ClipboardEvent): void {
    const text = event.clipboardData?.getData('text') ?? '';
    if (!/[,;\s]/.test(text.trim())) return;
    event.preventDefault();
    const emails = text.split(/[,;\s]+/).filter(Boolean);
    const valid = emails.filter((e) => EMAIL_RE.test(e));
    this.addEmails(valid);
    this.invalidEmail.set(valid.length < emails.length);
  }

  onBlur(): void {
    // El clic en una opción llega antes que el cierre (mousedown evita el blur); aquí solo se cierra la lista.
    this.open.set(false);
    if (this.query().trim()) this.addTyped();
  }

  add(option: PickerOption): void {
    this.addEmails([option.email], option.name);
  }

  addTyped(): void {
    const typed = this.query().trim();
    if (!typed) return;
    const owner = this.owners().find((o) => o.email.toLowerCase() === typed.toLowerCase());
    if (owner) {
      this.addEmails([owner.email], owner.fullName);
    } else if (EMAIL_RE.test(typed)) {
      this.addEmails([typed]);
    } else {
      this.invalidEmail.set(true);
    }
  }

  private addEmails(emails: string[], name?: string): void {
    const current = this.attendees();
    const known = new Set(current.map((a) => a.email.toLowerCase()));
    const added: JuntaAttendee[] = [];
    for (const email of emails) {
      if (known.has(email.toLowerCase())) continue;
      known.add(email.toLowerCase());
      const owner = this.owners().find((o) => o.email.toLowerCase() === email.toLowerCase());
      added.push({ email, name: name ?? owner?.fullName });
    }
    if (added.length) this.attendeesChange.emit([...current, ...added]);
    this.query.set('');
    this.invalidEmail.set(false);
    this.open.set(false);
  }

  remove(email: string): void {
    this.attendeesChange.emit(this.attendees().filter((a) => a.email !== email));
  }

  addAll(): void {
    this.addEmails(this.owners().map((o) => o.email));
  }

  clearAll(): void {
    this.attendeesChange.emit([]);
  }

  focusSearch(): void {
    this.host.nativeElement.querySelector<HTMLInputElement>('input')?.focus();
    this.open.set(true);
  }
}
