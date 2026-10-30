import {
  afterNextRender,
  Component,
  computed,
  ElementRef,
  HostListener,
  inject,
  Injector,
  input,
  signal,
  viewChild,
} from "@angular/core";
import { Router } from "@angular/router";
import { CommunityScopeService } from "../../../core/community-scope.service";
import { EstatesService } from "../../../core/estates.service";
import { TenantContextService } from "../../../core/tenant-context.service";
import { Estate } from "../../../core/models";
import {
  formatEstateAddress,
  normalizeEstateSearch,
} from "../../../core/estate-display";
import { IconComponent } from "../../../shared/components/icon/icon.component";

@Component({
  selector: "app-estate-scope-selector",
  standalone: true,
  imports: [IconComponent],
  templateUrl: "./estate-scope-selector.component.html",
  styleUrl: "./estate-scope-selector.component.scss",
})
export class EstateScopeSelectorComponent {
  readonly open = signal(false);
  readonly query = signal("");
  readonly loading = signal(false);
  readonly error = signal(false);
  private readonly rows = signal<Estate[]>([]);
  private loaded = false;
  private readonly data = inject(EstatesService);
  private readonly tenant = inject(TenantContextService);
  private readonly scope = inject(CommunityScopeService);
  /**
   * `true` (por defecto, «Fincas»): al elegir se abre la ficha. `false` («Vista general»):
   * solo cambia la selección y la propia pantalla se filtra, sin redirigir.
   */
  readonly redirect = input(true);
  readonly selected = this.scope.selected;
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly trigger =
    viewChild.required<ElementRef<HTMLButtonElement>>("trigger");
  private readonly search = viewChild<ElementRef<HTMLInputElement>>("search");
  readonly address = formatEstateAddress;
  readonly filtered = computed(() =>
    this.rows().filter(
      (estate) =>
        this.tenant.canAccessEstate(estate.id) &&
        this.tenant.canAccess(estate.administratorId) &&
        normalizeEstateSearch(
          `${estate.name} ${estate.address} ${estate.streetNumber ?? ""} ${estate.location}`,
        ).includes(normalizeEstateSearch(this.query())),
    ),
  );

  toggle(): void {
    if (this.open()) {
      this.close();
      return;
    }
    this.open.set(true);
    this.query.set("");
    if (!this.loaded) void this.load();
    afterNextRender(
      { write: () => this.search()?.nativeElement.focus() },
      { injector: this.injector },
    );
  }
  async load(): Promise<void> {
    if (this.loading()) return;
    this.loading.set(true);
    this.error.set(false);
    try {
      this.rows.set(await this.data.listEstates());
      this.loaded = true;
    } catch {
      this.error.set(true);
    } finally {
      this.loading.set(false);
    }
  }
  close(focus = false): void {
    this.open.set(false);
    if (focus) this.trigger().nativeElement.focus();
  }
  select(estate: Estate | null): void {
    if (
      estate &&
      (!this.tenant.canAccessEstate(estate.id) ||
        !this.tenant.canAccess(estate.administratorId))
    )
      return;
    this.close(true);
    this.scope.select(estate?.id ?? null);
    if (!this.redirect()) return;
    void this.router.navigate(
      estate ? ["/b/estates", estate.id] : ["/b/estates"],
    );
  }
  onKeydown(event: KeyboardEvent): void {
    if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
    const buttons = Array.from(
      this.host.nativeElement.querySelectorAll<HTMLButtonElement>(
        ".scope-menu button:not(:disabled)",
      ),
    );
    if (!buttons.length) return;
    event.preventDefault();
    const current = buttons.indexOf(event.target as HTMLButtonElement);
    const next =
      current < 0
        ? event.key === "ArrowDown"
          ? 0
          : buttons.length - 1
        : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
          buttons.length;
    buttons[next].focus();
  }
  @HostListener("document:click", ["$event"]) outside(event: MouseEvent): void {
    if (!this.host.nativeElement.contains(event.target as Node)) this.close();
  }
  @HostListener("document:keydown.escape") escape(): void {
    if (this.open()) this.close(true);
  }
}
