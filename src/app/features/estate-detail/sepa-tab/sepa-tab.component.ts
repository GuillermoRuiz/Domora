import { Component, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BtnComponent } from '../../../shared/components/btn/btn.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { EstateSepaBilling } from '../../../core/models';
import { EstatesService } from '../../../core/estates.service';

/**
 * Pestaña "Acreedor SEPA" de la finca, extraída de `estate-detail`. Mismo
 * patrón que `documentos-tab/`: recibe el `estateId`, carga su propio estado
 * y avisa al padre (`saved`) para que refresque la puesta en marcha.
 */
@Component({
  selector: 'app-sepa-tab',
  standalone: true,
  imports: [BtnComponent, IconComponent, FormsModule],
  templateUrl: './sepa-tab.component.html',
  styleUrl: './sepa-tab.component.scss',
})
export class SepaTabComponent implements OnInit {
  @Input({ required: true }) estateId!: string;
  @Output() saved = new EventEmitter<void>();

  private estatesSvc = inject(EstatesService);

  billing = signal<EstateSepaBilling | null>(null);
  loaded = signal(false);
  editing = signal(false);
  saving = signal(false);
  creditorId = signal('');
  creditorIban = signal('');
  creditorBic = signal('');
  creditorPostalAddress = signal('');
  toastMessage = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    try {
      this.billing.set(await this.estatesSvc.getEstateSepaBilling(this.estateId));
      this.loaded.set(true);
    } catch (error) {
      console.error('Error cargando la facturación SEPA', error);
    }
  }

  openEdit(): void {
    const billing = this.billing();
    this.creditorId.set(billing?.creditorId ?? '');
    this.creditorIban.set(''); // nunca se precarga: editar = reemplazar
    this.creditorBic.set(billing?.creditorBic ?? '');
    this.creditorPostalAddress.set(billing?.creditorPostalAddress ?? '');
    this.editing.set(true);
  }

  closeEdit(): void {
    this.editing.set(false);
  }

  async save(): Promise<void> {
    this.saving.set(true);
    try {
      const patch: { creditorId?: string; creditorIban?: string; creditorBic?: string; creditorPostalAddress?: string } = {
        creditorId: this.creditorId().trim() || undefined,
        creditorBic: this.creditorBic().trim() || undefined,
        creditorPostalAddress: this.creditorPostalAddress().trim() || undefined,
      };
      const newIban = this.creditorIban().trim();
      if (newIban) patch.creditorIban = newIban;
      this.billing.set(await this.estatesSvc.updateEstateSepaBilling(this.estateId, patch));
      this.editing.set(false);
      this.showToast('Facturación SEPA actualizada correctamente');
      this.saved.emit();
    } catch (error) {
      console.error('Error actualizando la facturación SEPA', error);
      this.showToast('No se pudo actualizar la facturación SEPA (revisa el formato del CID/IBAN)');
    } finally {
      this.saving.set(false);
    }
  }

  private showToast(msg: string): void {
    this.toastMessage.set(msg);
    setTimeout(() => this.toastMessage.set(null), 2500);
  }
}
