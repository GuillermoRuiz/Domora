import {
  Component,
  ElementRef,
  HostListener,
  inject,
  OnDestroy,
  signal,
  viewChild,
} from "@angular/core";
import { Router } from "@angular/router";
import { EstatesService } from "../../../core/estates.service";
import { EstateManagementSearchResult } from "../../../core/estate-overview.models";
import { IconComponent } from "../../../shared/components/icon/icon.component";

@Component({
  selector: "app-estate-management-search",
  standalone: true,
  imports: [IconComponent],
  templateUrl: "./estate-management-search.component.html",
  styleUrl: "./estate-management-search.component.scss",
})
export class EstateManagementSearchComponent implements OnDestroy {
  readonly query = signal("");
  readonly open = signal(false);
  readonly loading = signal(false);
  readonly error = signal(false);
  readonly results = signal<EstateManagementSearchResult[]>([]);
  private readonly data = inject(EstatesService);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly search =
    viewChild.required<ElementRef<HTMLInputElement>>("search");
  private timer?: ReturnType<typeof setTimeout>;
  private version = 0;
  private restoringFocus = false;
  readonly labels = {
    community: "Comunidad",
    owner: "Propietario",
    issue: "Incidencia",
  };
  readonly icons = {
    community: "building",
    owner: "users",
    issue: "exclamation",
  };

  onInput(value: string): void {
    this.query.set(value);
    this.results.set([]);
    this.error.set(false);
    clearTimeout(this.timer);
    this.version++;
    const valid = value.trim().length >= 2;
    this.open.set(valid);
    this.loading.set(valid);
    if (valid) this.timer = setTimeout(() => void this.load(), 275);
  }
  async load(): Promise<void> {
    const version = ++this.version;
    this.loading.set(true);
    this.error.set(false);
    this.open.set(true);
    try {
      const results = await this.data.searchManagement(this.query().trim());
      if (version === this.version) this.results.set(results);
    } catch {
      if (version === this.version) this.error.set(true);
    } finally {
      if (version === this.version) this.loading.set(false);
    }
  }
  onFocus(): void {
    if (!this.restoringFocus && this.query().trim().length >= 2)
      this.open.set(true);
  }
  close(focus = false): void {
    clearTimeout(this.timer);
    this.version++;
    this.loading.set(false);
    this.open.set(false);
    if (focus) {
      this.restoringFocus = true;
      this.search().nativeElement.focus();
      this.restoringFocus = false;
    }
  }
  select(result: EstateManagementSearchResult): void {
    this.close(true);
    void this.router.navigate(["/b/estates", result.estateId], {
      queryParams:
        result.kind === "issue"
          ? { tab: "issues", entity: result.issueId }
          : result.kind === "owner"
            ? { tab: "properties" }
            : {},
    });
  }
  onKeydown(event: KeyboardEvent): void {
    if (
      event.key === "Enter" &&
      event.target === this.search().nativeElement &&
      this.open() &&
      this.results().length
    ) {
      event.preventDefault();
      this.select(this.results()[0]);
      return;
    }
    if (!this.open() || !["ArrowDown", "ArrowUp"].includes(event.key)) return;
    const buttons = Array.from(
      this.host.nativeElement.querySelectorAll<HTMLButtonElement>(
        ".search-results button",
      ),
    );
    if (!buttons.length) return;
    event.preventDefault();
    const index = buttons.indexOf(event.target as HTMLButtonElement);
    const next =
      index < 0
        ? event.key === "ArrowDown"
          ? 0
          : buttons.length - 1
        : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
          buttons.length;
    buttons[next].focus();
  }
  @HostListener("document:click", ["$event"]) outside(event: MouseEvent): void {
    if (!this.host.nativeElement.contains(event.target as Node)) this.close();
  }
  @HostListener("document:keydown.escape") escape(): void {
    if (this.open()) this.close(true);
  }
  ngOnDestroy(): void {
    clearTimeout(this.timer);
    this.version++;
  }
}
