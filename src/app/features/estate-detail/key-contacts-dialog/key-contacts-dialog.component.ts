import { Component, ElementRef, OnInit, afterNextRender, inject, input, output, signal, viewChild } from '@angular/core';
import { BtnComponent } from '../../../shared/components/btn/btn.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { EstateGovernanceService, type OfficeHolder } from '../../../core/estate-governance.service';
import { EstateGeneralService } from '../../../core/estate-general.service';

/**
 * Marks which owners of a property are key contacts of the estate (shown in
 * «Datos generales»). One switch per owner: with co-owners the manager picks
 * the person. Each switch saves on its own.
 */
@Component({
  selector: 'app-key-contacts-dialog',
  standalone: true,
  imports: [BtnComponent, IconComponent],
  templateUrl: './key-contacts-dialog.component.html',
  styleUrl: './key-contacts-dialog.component.scss',
  host: { '(document:keydown.escape)': 'closed.emit()' },
})
export class KeyContactsDialogComponent implements OnInit {
  readonly estateId = input.required<string>();
  readonly propertyId = input.required<string>();
  readonly propertyLabel = input.required<string>();
  /** At least one switch changed: the parent may want to refresh. */
  readonly changed = output<void>();
  readonly closed = output<void>();

  private readonly governance = inject(EstateGovernanceService);
  private readonly general = inject(EstateGeneralService);
  private readonly closeButton = viewChild<ElementRef<HTMLButtonElement>>('closeButton');

  /** null = loading. */
  readonly holders = signal<OfficeHolder[] | null>(null);
  readonly saving = signal<number | null>(null);
  readonly error = signal('');

  constructor() {
    afterNextRender(() => this.closeButton()?.nativeElement.focus());
  }

  async ngOnInit(): Promise<void> {
    try {
      const properties = await this.governance.candidates(this.estateId());
      this.holders.set(properties.find(p => p.id === this.propertyId())?.holders ?? []);
    } catch {
      this.holders.set([]);
      this.error.set('No se pudieron cargar los titulares de la propiedad. Cierra y vuelve a intentarlo.');
    }
  }

  async toggle(index: number): Promise<void> {
    const list = this.holders();
    const holder = list?.[index];
    if (!list || !holder || this.saving() !== null) return;
    const keyContact = !holder.keyContact;
    this.saving.set(index);
    this.error.set('');
    try {
      await this.general.setKeyContact(this.estateId(), {
        propertyId: this.propertyId(), userId: holder.userId ?? undefined, externalOwnerId: holder.externalOwnerId ?? undefined, keyContact,
      });
      this.holders.set(list.map((h, i) => (i === index ? { ...h, keyContact } : h)));
      this.changed.emit();
    } catch (error: any) {
      const message = error?.error?.message;
      this.error.set(typeof message === 'string' ? message : 'No se pudo guardar el cambio. Vuelve a intentarlo.');
    } finally {
      this.saving.set(null);
    }
  }
}
