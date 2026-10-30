import { Component, Input, Output, EventEmitter, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { IconComponent } from '../icon/icon.component';
import { BtnComponent } from '../btn/btn.component';

/**
 * Modal compartido de "Pagar ahora" / "Pagar" — no hay pasarela de pago real
 * en el proyecto (Stripe/Redsys/PayPal), así que en vez de simular un cobro
 * que nunca ocurre, se muestran instrucciones de transferencia honestas con
 * el IBAN real de la finca (`Estate.iban`).
 */
@Component({
  selector: 'app-transfer-instructions-modal',
  standalone: true,
  imports: [CurrencyPipe, IconComponent, BtnComponent],
  templateUrl: './transfer-instructions-modal.component.html',
  styleUrl: './transfer-instructions-modal.component.scss',
})
export class TransferInstructionsModalComponent {
  @Input() iban: string | null = null;
  @Input() estateName: string | null = null;
  @Input() amount = 0;
  @Input() concept = '';
  @Output() closed = new EventEmitter<void>();

  copied = signal(false);

  formattedIban(): string {
    if (!this.iban) return '';
    return this.iban.replace(/(.{4})/g, '$1 ').trim();
  }

  async copyIban(): Promise<void> {
    if (!this.iban) return;
    try {
      await navigator.clipboard.writeText(this.iban);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch (error) {
      console.error('Error copiando el IBAN', error);
    }
  }

  close(): void {
    this.closed.emit();
  }
}
