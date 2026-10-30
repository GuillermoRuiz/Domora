import { Component, EventEmitter, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { BtnComponent } from '../../../shared/components/btn/btn.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { RETURN_FILE_ITEM_STATUS_LABELS, ReturnFile, ReturnFileItemStatus } from '../../../core/models';
import { SepaService } from '../../../core/sepa.service';

const FORMAT_LABELS: Record<ReturnFile['format'], string> = {
  pain002: 'Estado de la remesa (pain.002)',
  camt054: 'Aviso de devoluciones (camt.054)',
};

function apiMessage(error: any, fallback: string): string {
  const msg = error?.error?.message;
  if (Array.isArray(msg)) return msg.join(' ');
  return typeof msg === 'string' ? msg : fallback;
}

/**
 * Importar el fichero de devoluciones del banco. Subirlo no contabiliza
 * nada: se muestra cada devolución emparejada con su recibo para revisarla,
 * y solo al aplicar se registran. Aplicar dos veces, o subir el mismo
 * fichero otra vez, no duplica nada.
 */
@Component({
  selector: 'app-importar-devoluciones',
  standalone: true,
  imports: [DatePipe, BtnComponent, IconComponent],
  templateUrl: './importar-devoluciones.component.html',
  styleUrls: ['../cobros/cobros-modal.scss', './importar-devoluciones.component.scss'],
})
export class ImportarDevolucionesComponent implements OnInit {
  @Input({ required: true }) estateId!: string;
  @Output() closed = new EventEmitter<{ changed: boolean }>();

  private sepa = inject(SepaService);

  files = signal<ReturnFile[]>([]);
  current = signal<ReturnFile | null>(null);
  busy = signal(false);
  error = signal<string | null>(null);
  notice = signal<string | null>(null);
  private changed = false;

  statusLabels = RETURN_FILE_ITEM_STATUS_LABELS;
  formatLabels = FORMAT_LABELS;
  countOrder: ReturnFileItemStatus[] = ['matched', 'applied', 'already_returned', 'unmatched', 'failed'];

  /** Partidas que se contabilizarían al aplicar (las que fallaron se reintentan). */
  toApply = computed(() => {
    const c = this.current()?.counts;
    return c ? c.matched + c.failed : 0;
  });

  async ngOnInit(): Promise<void> {
    try {
      this.files.set(await this.sepa.listReturnFiles(this.estateId));
    } catch (error) {
      console.error('Error cargando ficheros de devoluciones', error);
    }
  }

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    await this.run(async () => {
      const uploaded = await this.sepa.uploadReturnFile(this.estateId, file);
      this.current.set(uploaded);
      this.notice.set(uploaded.duplicate ? 'Este fichero ya se había subido: se muestra el mismo, sin duplicar nada.' : null);
      this.files.set(await this.sepa.listReturnFiles(this.estateId));
    }, 'No se pudo leer el fichero.');
  }

  async open(file: ReturnFile): Promise<void> {
    await this.run(async () => {
      this.current.set(await this.sepa.getReturnFile(file.id));
      this.notice.set(null);
    }, 'No se pudo abrir el fichero.');
  }

  async apply(): Promise<void> {
    const file = this.current();
    if (!file) return;
    await this.run(async () => {
      const result = await this.sepa.applyReturnFile(file.id);
      this.current.set(result);
      this.changed = true;
      const s = result.summary;
      this.notice.set(
        s
          ? [
              `${s.applied} devolución(es) contabilizada(s).`,
              s.alreadyReturned ? `${s.alreadyReturned} ya estaban devueltas.` : '',
              s.failed ? `${s.failed} no se pudieron aplicar: revisa el motivo en cada una.` : '',
            ].filter(Boolean).join(' ')
          : null,
      );
      this.files.set(await this.sepa.listReturnFiles(this.estateId));
    }, 'No se pudo aplicar el fichero.');
  }

  back(): void {
    this.current.set(null);
    this.notice.set(null);
    this.error.set(null);
  }

  close(): void {
    this.closed.emit({ changed: this.changed });
  }

  statusClass(status: ReturnFileItemStatus): string {
    return `item-status item-status--${status}`;
  }

  fmtEur(n: number | null): string {
    if (n === null) return '—';
    return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  }

  private async run(fn: () => Promise<void>, fallback: string): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await fn();
    } catch (error) {
      this.error.set(apiMessage(error, fallback));
    } finally {
      this.busy.set(false);
    }
  }
}
