import { Component, EventEmitter, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { SelectDropdownDirective } from '../../../shared/components/dropdown/select-dropdown.directive';
import { FormsModule } from '@angular/forms';
import { InspectionsService } from '../../../core/inspections.service';
import { INSTALLATION_TYPE_OPTIONS, INSTALLATION_TYPES, installationTypeFor } from '../../../core/installation-types';
import { OPERATIONAL_STATUS_OPTIONS, type AssetOperationalStatus, type Installation, type InstallationInput } from '../../../core/installations.models';
import { BtnComponent } from '../../../shared/components/btn/btn.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';

export interface SupplierOption {
  id: string;
  name: string;
}

/** Mensaje legible de un error de la API (el backend manda `message` como texto o como lista). */
function messageFrom(error: unknown, fallback: string): string {
  const message = (error as { error?: { message?: unknown } })?.error?.message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message) && message.length > 0) return message.join(' ');
  return fallback;
}

/**
 * Alta y edición de una instalación (elemento común). Sin `installation` crea;
 * con ella edita y solo envía lo que cambia. El tipo se elige del catálogo;
 * "Otro" deja escribir una descripción libre, y al editar se conserva el
 * texto que ya tenía mientras no se cambie de tipo.
 */
@Component({
  selector: 'app-installation-form-modal',
  standalone: true,
  imports: [SelectDropdownDirective, FormsModule, BtnComponent, IconComponent],
  templateUrl: './installation-form-modal.component.html',
  styleUrl: './installation-form-modal.component.scss',
})
export class InstallationFormModalComponent implements OnInit {
  @Input({ required: true }) estateId!: string;
  /** null = alta nueva. */
  @Input() installation: Installation | null = null;
  @Input() suppliers: SupplierOption[] = [];
  /** Se guardó: el panel recarga. */
  @Output() saved = new EventEmitter<void>();
  @Output() closed = new EventEmitter<void>();

  private inspections = inject(InspectionsService);

  readonly typeOptions = INSTALLATION_TYPE_OPTIONS;
  readonly statusOptions = OPERATIONAL_STATUS_OPTIONS;

  readonly name = signal('');
  readonly typeKey = signal('otro');
  /** Descripción libre cuando el tipo es "Otro". */
  readonly otherText = signal('');
  readonly location = signal('');
  readonly status = signal<AssetOperationalStatus>('operativa');
  /** '' = sin proveedor. */
  readonly supplierId = signal('');
  readonly manufacturer = signal('');
  readonly serialNumber = signal('');
  readonly notes = signal('');

  readonly submitted = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  readonly editing = computed(() => this.installation !== null);
  readonly nameInvalid = computed(() => this.submitted() && this.name().trim() === '');

  ngOnInit(): void {
    const i = this.installation;
    if (!i) {
      this.typeKey.set(INSTALLATION_TYPES[0].key);
      return;
    }
    const type = installationTypeFor(i.category);
    this.name.set(i.name);
    this.typeKey.set(type.key);
    if (type.key === 'otro') this.otherText.set(i.category === 'Otro' ? '' : i.category);
    this.location.set(i.location ?? '');
    this.status.set(i.operationalStatus);
    this.supplierId.set(i.supplier?.id ?? '');
    this.manufacturer.set(i.manufacturer ?? '');
    this.serialNumber.set(i.serialNumber ?? '');
    this.notes.set(i.notes ?? '');
  }

  /** Texto que se guarda como categoría. */
  private category(): string {
    const type = INSTALLATION_TYPES.find(t => t.key === this.typeKey()) ?? INSTALLATION_TYPES[INSTALLATION_TYPES.length - 1];
    if (type.key === 'otro') return this.otherText().trim() || 'Otro';
    // Si no ha cambiado de tipo se respeta el texto original ("Ascensores" en vez de "Ascensor").
    const original = this.installation?.category;
    return original && installationTypeFor(original).key === type.key ? original : type.label;
  }

  /** Vacío → null al editar (borra el campo) y undefined al crear (no se envía). */
  private optional(value: string): string | null | undefined {
    const trimmed = value.trim();
    if (trimmed) return trimmed;
    return this.editing() ? null : undefined;
  }

  async submit(): Promise<void> {
    this.submitted.set(true);
    if (this.name().trim() === '' || this.saving()) return;
    this.saving.set(true);
    this.error.set(null);
    try {
      const payload: InstallationInput = {
        name: this.name().trim(),
        category: this.category(),
        location: this.optional(this.location()),
        manufacturer: this.optional(this.manufacturer()),
        serialNumber: this.optional(this.serialNumber()),
        notes: this.optional(this.notes()),
        operationalStatus: this.status(),
        supplierId: this.supplierId() || (this.editing() ? null : undefined),
      };
      if (this.installation) {
        await this.inspections.updateAsset(this.estateId, this.installation.id, payload);
      } else {
        await this.inspections.createAsset(this.estateId, {
          name: payload.name,
          category: payload.category,
          location: payload.location ?? undefined,
          manufacturer: payload.manufacturer ?? undefined,
          serialNumber: payload.serialNumber ?? undefined,
          notes: payload.notes ?? undefined,
          operationalStatus: payload.operationalStatus,
          supplierId: payload.supplierId ?? undefined,
        });
      }
      this.saved.emit();
    } catch (error) {
      console.error('Error guardando la instalación', error);
      this.error.set(messageFrom(error, 'No se pudo guardar la instalación. Inténtalo de nuevo.'));
    } finally {
      this.saving.set(false);
    }
  }
}
