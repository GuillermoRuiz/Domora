import {
  Component,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from "@angular/core";
import { DatePipe } from "@angular/common";
import { RouterLink } from "@angular/router";
import { AiService, type AiReconciliationView } from "../../core/ai.service";
@Component({
  selector: "app-accounting-ai-panel",
  standalone: true,
  imports: [DatePipe, RouterLink],
  styleUrl: "./ai-panel.scss",
  host: { "[class.ai-panel--compact]": "compact()" },
  template: `
    @if (compact()) {
      @if (view(); as value) {
        @if (value.total > 0) {
          <div class="reconciliation-notice" role="status">
            <p><strong>{{ value.total }}</strong> {{ value.total === 1 ? 'propuesta de conciliación pendiente' : 'propuestas de conciliación pendientes' }}.</p>
            <button type="button" (click)="reviewRequested.emit()">Revisar en Tesorería</button>
          </div>
        }
      }
    } @else {
    <section
      class="ai-panel"
      aria-labelledby="accounting-ai-title"
      [attr.aria-busy]="busy()"
    >
      <header>
        <h3 id="accounting-ai-title">Conciliación asistida</h3>
        <button type="button" [disabled]="busy()" (click)="refresh()">
          Actualizar
        </button>
      </header>
      @if (error()) {
        <p class="error" role="alert">{{ error() }}</p>
      }
      @if (view(); as value) {
        <dl class="kpis">
          <div>
            <dt>Movimientos bancarios</dt>
            <dd>{{ value.counts.bankMovements }}</dd>
          </div>
          <div>
            <dt>Conciliados automáticamente</dt>
            <dd>{{ value.counts.automaticallyReconciled }}</dd>
          </div>
          <div>
            <dt>Propuestos</dt>
            <dd>{{ value.counts.suggested }}</dd>
          </div>
          <div>
            <dt>Sin conciliar</dt>
            <dd>{{ value.counts.unmatched }}</dd>
          </div>
        </dl>
        @for (suggestion of value.data; track suggestion.id) {
          <details class="item">
            <summary>
              Revisar propuesta · Evidencia {{ suggestion.evidence.score }}/100
            </summary>
            <p class="muted">
              Referencia exacta:
              {{ suggestion.evidence.evidence.exactReference ? "Sí" : "No" }} ·
              Diferencia máxima:
              {{ suggestion.evidence.evidence.maxDateDays }} días ·
              Competidores:
              {{ suggestion.evidence.evidence.competingCandidates }}
            </p>
            @for (entry of suggestion.entries; track entry.id) {
              <p>
                Banco · {{ entry.date | date: "dd/MM/yyyy" }} ·
                {{ entry.amount }} EUR · {{ entry.concept }}
              </p>
            }
            @for (line of suggestion.lines; track line.id) {
              <p>
                Diario · {{ line.date | date: "dd/MM/yyyy" }} · Debe
                {{ line.debit }} / Haber {{ line.credit }} EUR ·
                {{ line.concept }}
              </p>
            }
            @for (invoice of suggestion.invoices; track invoice.id) {
              <p>
                Factura {{ invoice.number }} · {{ invoice.supplier.name }} ·
                {{ invoice.payable }} EUR
              </p>
            }
            @if (suggestion.aiReview) {
              <p>
                Revisión sugerida: {{ suggestion.aiReview.evidence_summary }}
              </p>
            }
            @if (!suggestion.lineIds.length) {
              <p class="muted">
                Registra el pago desde Proveedores antes de conciliar. Esta
                propuesta no contabiliza pagos.
              </p>
            }
            <div class="actions">
              <button
                type="button"
                [disabled]="busy() || !suggestion.lineIds.length"
                (click)="accept(suggestion.id)"
              >
                Aceptar conciliación</button
              ><button
                type="button"
                [disabled]="busy()"
                (click)="reject(suggestion.id)"
              >
                Rechazar</button
              ><a
                [routerLink]="['/b/accounting', estateId()]"
                [queryParams]="{
                  tab: 'treasury',
                  bank: suggestion.bankAccountId,
                }"
                >Ver cuenta bancaria</a
              >
            </div>
          </details>
        }
        @if (!value.data.length) {
          <p class="muted">No hay propuestas pendientes.</p>
        }
        <div class="actions">
          <button
            type="button"
            [disabled]="busy() || page() === 1"
            (click)="changePage(-1)"
          >
            Anterior</button
          ><span>Página {{ page() }}</span
          ><button
            type="button"
            [disabled]="busy() || page() * 30 >= value.total"
            (click)="changePage(1)"
          >
            Siguiente
          </button>
        </div>
      }
    </section>
    }
  `,
})
export class AccountingAiPanelComponent {
  readonly estateId = input.required<string>();
  readonly compact = input(false);
  readonly reviewRequested = output<void>();
  private readonly api = inject(AiService);
  readonly view = signal<AiReconciliationView | null>(null);
  readonly page = signal(1);
  readonly busy = signal(false);
  readonly error = signal("");
  private generation = 0;
  constructor() {
    effect(() => {
      const id = this.estateId();
      untracked(() => {
        this.view.set(null);
        this.page.set(1);
        void this.load(id);
      });
    });
  }
  async load(id: string) {
    const version = ++this.generation;
    this.busy.set(true);
    this.error.set("");
    try {
      const view = await this.api.reconciliation(id, this.page());
      if (version === this.generation) this.view.set(view);
    } catch {
      if (version === this.generation)
        this.error.set("No se pudo cargar la conciliación.");
    } finally {
      if (version === this.generation) this.busy.set(false);
    }
  }
  refresh() {
    void this.load(this.estateId());
  }
  changePage(delta: number) {
    this.page.update((p) => p + delta);
    this.refresh();
  }
  async action(work: () => Promise<unknown>) {
    this.busy.set(true);
    this.error.set("");
    try {
      await work();
      this.refresh();
    } catch {
      this.error.set(
        "No se pudo completar la acción. Actualiza y revisa el estado de los registros.",
      );
      this.busy.set(false);
    }
  }
  accept(id: string) {
    void this.action(() => this.api.accept(this.estateId(), id));
  }
  reject(id: string) {
    void this.action(() => this.api.reject(this.estateId(), id));
  }
}
