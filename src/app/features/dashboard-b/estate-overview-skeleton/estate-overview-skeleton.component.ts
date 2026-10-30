import { Component, input } from "@angular/core";

@Component({
  selector: "app-estate-overview-skeleton",
  standalone: true,
  template: `@if (view() === "table") {
      <div class="table-skeleton">
        @for (row of rows; track row) {
          <div class="skeleton-row">
            <span class="skeleton-thumb"></span
            ><span class="skeleton-line"></span
            ><span class="skeleton-line"></span
            ><span class="skeleton-line"></span>
          </div>
        }
      </div>
    } @else {
      <div class="estates-grid">
        @for (card of rows; track card) {
          <div class="skeleton-card">
            <span class="skeleton-photo"></span
            ><span class="skeleton-line"></span
            ><span class="skeleton-line"></span>
          </div>
        }
      </div>
    }`,
  styleUrl: "./estate-overview-skeleton.component.scss",
})
export class EstateOverviewSkeletonComponent {
  readonly view = input<"table" | "cards">("table");
  readonly rows = Array.from({ length: 6 }, (_, index) => index);
}
