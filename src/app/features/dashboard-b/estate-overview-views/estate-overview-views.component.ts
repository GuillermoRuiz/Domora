import { Component, input, output } from "@angular/core";
import { RouterLink } from "@angular/router";
import {
  EstateOverviewItem,
  EstateOverviewSort,
} from "../../../core/estate-overview.models";
import { formatEstateAddress } from "../../../core/estate-display";
import { IconComponent } from "../../../shared/components/icon/icon.component";
import {
  EstateActionsMenuComponent,
  type EstateAction,
} from "../../../shared/components/estate-actions-menu/estate-actions-menu.component";
import { EstateFacadeThumbnailComponent } from "../estate-facade-thumbnail/estate-facade-thumbnail.component";

export interface EstateActionRequest {
  estate: EstateOverviewItem;
  action: EstateAction;
}

/** Presentation only: both views receive exactly the same paginated items. */
@Component({
  selector: "app-estate-overview-views",
  standalone: true,
  imports: [
    RouterLink,
    IconComponent,
    EstateActionsMenuComponent,
    EstateFacadeThumbnailComponent,
  ],
  templateUrl: "./estate-overview-views.component.html",
  styleUrl: "./estate-overview-views.component.scss",
})
export class EstateOverviewViewsComponent {
  readonly items = input.required<EstateOverviewItem[]>();
  readonly view = input<"table" | "cards">("table");
  readonly sortColumn = input<EstateOverviewSort>("name");
  readonly direction = input<"asc" | "desc">("asc");
  readonly pendingLabel = input("Cuotas pendientes");
  /** Pasos de puesta en marcha que faltan por finca (ausente = aún no se sabe). */
  readonly setupRemaining = input<Record<string, number | undefined>>({});
  readonly sort = output<EstateOverviewSort>();
  /** Acción elegida en el menú de una finca; la ejecuta el padre (navegar o abrir el asistente). */
  readonly estateAction = output<EstateActionRequest>();
  readonly address = formatEstateAddress;
  private readonly money = new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  fmtEur(value: number): string {
    return this.money.format(value);
  }
  ariaSort(column: EstateOverviewSort): "ascending" | "descending" | "none" {
    return this.sortColumn() === column
      ? this.direction() === "asc"
        ? "ascending"
        : "descending"
      : "none";
  }
}
