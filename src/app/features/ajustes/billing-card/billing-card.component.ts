import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminBillingService } from '../../../core/admin-billing.service';
import type { AdminPayMethod, OwnBilling, OwnBillingUpdate } from '../../../core/models';
import { BtnComponent } from '../../../shared/components/btn/btn.component';
import { isValidIban, isValidSpanishTaxId } from './billing-validators';

const METHODS: AdminPayMethod[] = ['Tarjeta', 'Transferencia', 'Domiciliación'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MSG = {
  businessName: 'Indica la razón social.',
  cif: 'El NIF/CIF no es válido: revisa la letra o el dígito de control.',
  address: 'Indica el domicilio fiscal.',
  email: 'El email de facturación no es válido.',
  iban: 'El IBAN no es válido (revisa los dígitos de control).',
  debtorName: 'Indica el titular de la cuenta.',
  mandate: 'Para domiciliar los cobros tienes que aceptar la orden de domiciliación SEPA.',
} as const;

/** Readable message of an API error (the backend sends `message` as text or as a list). */
function messageFrom(error: unknown, fallback: string): string {
  const message = (error as { error?: { message?: unknown } })?.error?.message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message) && message.length > 0) return message.join(' ');
  return fallback;
}

/**
 * «Datos de facturación» in role B settings (odd/tasks/role-a-panel.md S17):
 * the data shown on Domora's invoices to the despacho, its payment method and,
 * for domiciliación, the SEPA order it accepts. The IBAN only ever comes back
 * masked; a new account always means a new signed order.
 */
@Component({
  selector: 'app-billing-card',
  standalone: true,
  imports: [FormsModule, BtnComponent, DatePipe],
  templateUrl: './billing-card.component.html',
  styleUrl: './billing-card.component.scss',
})
export class BillingCardComponent implements OnInit {
  private service = inject(AdminBillingService);

  readonly methods = METHODS;
  readonly own = signal<OwnBilling | null>(null);
  readonly loadError = signal<string | null>(null);
  readonly editing = signal(false);
  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);
  readonly savedMessage = signal<string | null>(null);
  readonly submitted = signal(false);

  readonly businessName = signal('');
  readonly cif = signal('');
  readonly address = signal('');
  readonly email = signal('');
  readonly paymentMethod = signal<AdminPayMethod>('Transferencia');
  readonly iban = signal('');
  readonly debtorName = signal('');
  readonly accepted = signal(false);
  /** With an active mandate, the user asked to sign a new one for another account. */
  readonly changeAccount = signal(false);

  readonly sepaAvailable = computed(() => this.own()?.sepa.available ?? false);
  readonly activeMandate = computed(() => this.own()?.mandate ?? null);
  /** Domiciliación needs a new order: no active mandate, or a new account. */
  readonly needsMandate = computed(() => this.paymentMethod() === 'Domiciliación' && (!this.activeMandate() || this.changeAccount()));

  readonly errors = computed(() => {
    const errors: Partial<Record<keyof typeof MSG, string>> = {};
    if (!this.businessName().trim()) errors.businessName = MSG.businessName;
    if (!isValidSpanishTaxId(this.cif())) errors.cif = MSG.cif;
    if (!this.address().trim()) errors.address = MSG.address;
    if (!EMAIL.test(this.email().trim())) errors.email = MSG.email;
    if (this.needsMandate()) {
      if (!isValidIban(this.iban())) errors.iban = MSG.iban;
      if (!this.debtorName().trim()) errors.debtorName = MSG.debtorName;
      if (!this.accepted()) errors.mandate = MSG.mandate;
    }
    return errors;
  });
  readonly shownErrors = computed(() => (this.submitted() ? this.errors() : {}));

  async ngOnInit(): Promise<void> {
    try {
      this.own.set(await this.service.getOwn());
    } catch (error) {
      console.error('Error cargando los datos de facturación', error);
      this.loadError.set('No se pudieron cargar los datos de facturación.');
    }
  }

  startEdit(): void {
    const billing = this.own()?.billing;
    this.businessName.set(billing?.businessName ?? '');
    this.cif.set(billing?.cif ?? '');
    this.address.set(billing?.address ?? '');
    this.email.set(billing?.email ?? '');
    const method = billing?.paymentMethod ?? 'Transferencia';
    this.paymentMethod.set(method === 'Domiciliación' && !this.sepaAvailable() && !this.activeMandate() ? 'Transferencia' : method);
    this.iban.set('');
    this.debtorName.set(billing?.businessName ?? '');
    this.accepted.set(false);
    this.changeAccount.set(false);
    this.submitted.set(false);
    this.saveError.set(null);
    this.savedMessage.set(null);
    this.editing.set(true);
  }

  cancel(): void {
    this.editing.set(false);
  }

  async save(): Promise<void> {
    this.submitted.set(true);
    this.saveError.set(null);
    if (Object.keys(this.errors()).length > 0) return;
    const update: OwnBillingUpdate = {
      businessName: this.businessName().trim(),
      cif: this.cif().trim(),
      address: this.address().trim(),
      email: this.email().trim(),
      paymentMethod: this.paymentMethod(),
    };
    const reference = this.own()?.sepa.mandateReference;
    if (this.needsMandate() && reference) {
      update.iban = this.iban().replace(/\s+/g, '').toUpperCase();
      update.mandate = { accepted: true, reference, debtorName: this.debtorName().trim() };
    }
    this.saving.set(true);
    try {
      this.own.set(await this.service.updateOwn(update));
      this.editing.set(false);
      this.savedMessage.set('Datos de facturación guardados.');
    } catch (error) {
      console.error('Error guardando los datos de facturación', error);
      this.saveError.set(messageFrom(error, 'No se pudieron guardar los datos de facturación.'));
    } finally {
      this.saving.set(false);
    }
  }
}
