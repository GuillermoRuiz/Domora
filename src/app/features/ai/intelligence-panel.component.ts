import {
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from "@angular/core";
import { DatePipe } from "@angular/common";
import { RouterLink } from "@angular/router";
import { AiService, type AiIntelligenceView } from "../../core/ai.service";
import { IconComponent } from "../../shared/components/icon/icon.component";

type Priority = "high" | "medium" | "low";

/** Etiqueta y icono por tipo de entidad: lenguaje de propietario, no de contabilidad. */
const CATEGORIES: Record<string, { label: string; icon: string }> = {
  estate: { label: "Costes", icon: "chart" },
  invoice: { label: "Facturas", icon: "receipt" },
  contract: { label: "Contratos", icon: "file-text" },
  issue: { label: "Incidencias", icon: "exclamation" },
  event: { label: "Agenda", icon: "calendar" },
  bank: { label: "Cuentas", icon: "card" },
};

const PRIORITY_LABEL: Record<Priority, string> = {
  high: "Urgente",
  medium: "Atención",
  low: "Información",
};
const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

@Component({
  selector: "app-intelligence-panel",
  standalone: true,
  imports: [DatePipe, RouterLink, IconComponent],
  templateUrl: "./intelligence-panel.component.html",
  styleUrl: "./intelligence-panel.component.scss",
})
export class IntelligencePanelComponent {
  readonly estateId = input.required<string>();
  private readonly api = inject(AiService);
  readonly view = signal<AiIntelligenceView | null>(null);
  readonly loading = signal(false);
  readonly error = signal("");
  private generation = 0;

  /** Primero los avisos de gasto (lo que más le importa a un propietario) y, dentro de cada grupo, de más a menos urgente. */
  readonly cards = computed(() =>
    [...(this.view()?.latest?.items ?? [])].sort(
      (a, b) =>
        Number(a.entity_type !== "estate") -
          Number(b.entity_type !== "estate") ||
        PRIORITY_RANK[a.priority as Priority] -
          PRIORITY_RANK[b.priority as Priority],
    ),
  );

  constructor() {
    effect(() => {
      const id = this.estateId();
      untracked(() => {
        this.view.set(null);
        void this.load(id);
      });
    });
  }

  async load(id: string) {
    const version = ++this.generation;
    this.loading.set(true);
    this.error.set("");
    try {
      const value = await this.api.intelligence(id);
      if (version === this.generation) this.view.set(value);
    } catch {
      if (version === this.generation)
        this.error.set("No se pudo cargar la revisión.");
    } finally {
      if (version === this.generation) this.loading.set(false);
    }
  }

  refresh() {
    void this.load(this.estateId());
  }

  category(entityType: string) {
    return CATEGORIES[entityType] ?? { label: "Comunidad", icon: "home" };
  }

  priorityLabel(priority: string) {
    return PRIORITY_LABEL[priority as Priority] ?? "Información";
  }

  query(link: string) {
    return Object.fromEntries(new URLSearchParams(link.split("?")[1] ?? ""));
  }
}
