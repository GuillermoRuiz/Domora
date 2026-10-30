import { Component, EventEmitter, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { SelectDropdownDirective } from '../../../../shared/components/dropdown/select-dropdown.directive';
import { FormsModule } from '@angular/forms';
import { SuppliersStaffService } from '../../../../core/suppliers-staff.service';
import { SUPPLIER_CATEGORIES, SUPPLIER_CATEGORY_OPTIONS, supplierCategoryFor } from '../../../../core/supplier-categories';
import type { SupplierPanelRow } from '../../../../core/supplier-panel.models';
import { BtnComponent } from '../../../../shared/components/btn/btn.component';
import { IconComponent } from '../../../../shared/components/icon/icon.component';

/** Mensaje legible de un error de la API (el backend manda `message` como texto o como lista). */
function messageFrom(error: unknown, fallback: string): string {
  const message = (error as { error?: { message?: unknown } })?.error?.message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message) && message.length > 0) return message.join(' ');
  return fallback;
}

/** Correo con forma de correo: lo mismo que exige el servidor, para avisar antes de enviar. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Alta y edición de un proveedor desde el panel: nombre, categoría y datos de
 * contacto. Los datos fiscales (CIF, IBAN, 347) se siguen manteniendo en
 * «Facturas y pagos». Sin `supplier` crea; con él edita y solo envía lo que
 * cambia (un contacto vaciado se borra).
 */
@Component({
  selector: 'app-supplier-form-modal',
  standalone: true,
  imports: [SelectDropdownDirective, FormsModule, BtnComponent, IconComponent],
  templateUrl: './supplier-form-modal.component.html',
  styleUrl: './supplier-form-modal.component.scss',
})
export class SupplierFormModalComponent implements OnInit {
  @Input({ required: true }) estateId!: string;
  /** null = alta nueva. */
  @Input() supplier: SupplierPanelRow | null = null;
  /** Se guardó: el panel recarga. */
  @Output() saved = new EventEmitter<void>();
  @Output() closed = new EventEmitter<void>();

  private api = inject(SuppliersStaffService);

  readonly categoryOptions = SUPPLIER_CATEGORY_OPTIONS;

  readonly name = signal('');
  readonly categoryKey = signal(SUPPLIER_CATEGORIES[0].key);
  /** Descripción libre cuando la categoría es "Otro". */
  readonly otherText = signal('');
  readonly contactName = signal('');
  readonly phone = signal('');
  readonly email = signal('');

  readonly submitted = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  readonly editing = computed(() => this.supplier !== null);
  readonly nameInvalid = computed(() => this.submitted() && this.name().trim() === '');
  readonly emailInvalid = computed(() => this.submitted() && this.email().trim() !== '' && !EMAIL.test(this.email().trim()));

  ngOnInit(): void {
    const s = this.supplier;
    if (!s) return;
    const category = supplierCategoryFor(s.category);
    this.name.set(s.name);
    this.categoryKey.set(category.key);
    if (category.key === 'otro') this.otherText.set(s.category === 'Otro' ? '' : s.category);
    this.contactName.set(s.contactName ?? '');
    this.phone.set(s.phone ?? '');
    this.email.set(s.email ?? '');
  }

  /** Texto que se guarda como categoría. */
  private category(): string {
    const category = SUPPLIER_CATEGORIES.find(c => c.key === this.categoryKey()) ?? SUPPLIER_CATEGORIES[SUPPLIER_CATEGORIES.length - 1];
    if (category.key === 'otro') return this.otherText().trim() || 'Otro';
    // Si no ha cambiado de categoría se respeta el texto original ("Ascensores" en vez de la etiqueta del catálogo).
    const original = this.supplier?.category;
    return original && supplierCategoryFor(original).key === category.key ? original : category.label;
  }

  async submit(): Promise<void> {
    this.submitted.set(true);
    if (this.name().trim() === '' || this.emailInvalid() || this.saving()) return;
    this.saving.set(true);
    this.error.set(null);
    try {
      const contactName = this.contactName().trim();
      const phone = this.phone().trim();
      const email = this.email().trim();
      const s = this.supplier;
      if (s) {
        // Solo lo que cambia; un campo de contacto vaciado se envía como null para borrarlo.
        const patch: Parameters<SuppliersStaffService['updateSupplier']>[2] = {};
        if (this.name().trim() !== s.name) patch.name = this.name().trim();
        if (this.category() !== s.category) patch.category = this.category();
        if (contactName !== (s.contactName ?? '')) patch.contactName = contactName || null;
        if (phone !== (s.phone ?? '')) patch.phone = phone || null;
        if (email !== (s.email ?? '')) patch.email = email || null;
        if (Object.keys(patch).length > 0) await this.api.updateSupplier(this.estateId, s.id, patch);
      } else {
        await this.api.createSupplier(this.estateId, {
          name: this.name().trim(),
          category: this.category(),
          ...(contactName && { contactName }),
          ...(phone && { phone }),
          ...(email && { email }),
        });
      }
      this.saved.emit();
    } catch (error) {
      console.error('Error guardando el proveedor', error);
      this.error.set(messageFrom(error, 'No se pudo guardar el proveedor. Inténtalo de nuevo.'));
    } finally {
      this.saving.set(false);
    }
  }
}
