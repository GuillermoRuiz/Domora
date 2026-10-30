import { afterNextRender, Component, computed, ElementRef, HostListener, inject, Injector, input, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { CommunityScopeService } from '../../../core/community-scope.service';
import { EstatesService } from '../../../core/estates.service';
import { TenantContextService } from '../../../core/tenant-context.service';
import { AccountingEstate, Estate } from '../../../core/models';
import { AccountingTab } from '../../../core/accounting-navigation.service';
import { IconComponent } from '../../../shared/components/icon/icon.component';

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim();
}

@Component({
  selector: 'app-accounting-community-selector',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './accounting-community-selector.component.html',
  styleUrl: './accounting-community-selector.component.scss',
})
export class AccountingCommunitySelectorComponent {
  readonly estate = input<AccountingEstate | null>(null);
  readonly activeTab = input<AccountingTab>('summary');
  readonly label = computed(() => this.estate()?.name || 'Todas mis comunidades');
  readonly open = signal(false);
  readonly query = signal('');
  readonly loading = signal(false);
  readonly error = signal('');
  private readonly estates = signal<Estate[]>([]);
  private readonly data = inject(EstatesService);
  private readonly tenant = inject(TenantContextService);
  private readonly router = inject(Router);
  private readonly scope = inject(CommunityScopeService);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
  private readonly search = viewChild<ElementRef<HTMLInputElement>>('search');
  private loaded = false;

  readonly filteredEstates = computed(() => {
    const q = normalize(this.query());
    return this.estates().filter(estate =>
      this.tenant.canAccessEstate(estate.id) && this.tenant.canAccess(estate.administratorId) &&
      (!q || normalize(`${estate.name} ${this.address(estate)}`).includes(q)),
    );
  });

  address(estate: Estate): string {
    return [[estate.address, estate.streetNumber].filter(Boolean).join(' '), estate.location].filter(Boolean).join(', ');
  }

  toggle(): void {
    if (this.open()) { this.close(); return; }
    this.open.set(true);
    this.query.set('');
    if (!this.loaded && !this.loading()) void this.loadEstates();
    afterNextRender({ write: () => this.search()?.nativeElement.focus() }, { injector: this.injector });
  }

  async loadEstates(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      this.estates.set(await this.data.listEstates());
      this.loaded = true;
    } catch {
      this.error.set('No se pudieron cargar las comunidades.');
    } finally {
      this.loading.set(false);
    }
  }

  close(restoreFocus = false): void {
    this.open.set(false);
    if (restoreFocus) this.trigger().nativeElement.focus();
  }

  select(estate: Estate): void {
    if (!this.tenant.canAccessEstate(estate.id) || !this.tenant.canAccess(estate.administratorId)) return;
    this.close(true);
    if (estate.id === this.estate()?.id) return;
    void this.router.navigate(['/b/accounting', estate.id], { queryParams: { tab: this.activeTab() } });
  }

  viewAll(): void {
    this.close();
    this.scope.select(null);
    void this.router.navigate(['/b/accounting']);
  }

  onSearch(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  onMenuKeydown(event: KeyboardEvent): void {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const buttons = Array.from(this.host.nativeElement.querySelectorAll<HTMLButtonElement>('.community-selector__menu button:not(:disabled)'));
    if (!buttons.length) return;
    event.preventDefault();
    const current = buttons.indexOf(event.target as HTMLButtonElement);
    const next = event.key === 'ArrowDown' ? (current + 1) % buttons.length : (current <= 0 ? buttons.length - 1 : current - 1);
    buttons[next].focus();
  }

  @HostListener('document:click', ['$event'])
  onOutsideClick(event: MouseEvent): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.close();
  }

  @HostListener('document:keydown.escape', ['$event'])
  onEscape(event: Event): void {
    if (!this.open()) return;
    event.preventDefault();
    this.close(true);
  }
}
