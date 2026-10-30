import { Component, HostListener, Input, computed, inject, signal, viewChild, ElementRef, afterNextRender, DestroyRef, Renderer2, RendererStyleFlags2 } from '@angular/core';
import { Router } from '@angular/router';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { StateService } from '../../core/state.service';
import { AlertType } from '../../core/models';
import { BadgeComponent } from '../../shared/components/badge/badge.component';
import { AccountMenuComponent } from '../account-menu/account-menu.component';
import { ResourceReadsService } from '../../core/resource-reads.service';

const TYPE_ICON: Record<AlertType, string> = {
  pago: 'card', incidencia: 'exclamation', junta: 'users', documento: 'key', comunidad: 'building', proveedor: 'store', presupuesto: 'chart',
};

/**
 * Se reinstancia en cada pantalla (no es singleton como el sidebar) — por
 * eso lee el estado global de NavigationStatusService, sin repetir
 * consultas al cambiar de pantalla.
 */
@Component({
  selector: 'app-topbar',
  standalone: true,
  imports: [IconComponent, BadgeComponent, AccountMenuComponent],
  templateUrl: './topbar.component.html',
  styleUrl: './topbar.component.scss'
})
export class TopbarComponent {
  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef);
    const renderer = inject(Renderer2);
    const destroy = inject(DestroyRef);
    afterNextRender(() => {
      const header = host.nativeElement.querySelector<HTMLElement>('.topbar');
      const shell = host.nativeElement.closest<HTMLElement>('.app-shell');
      const main = host.nativeElement.closest<HTMLElement>('.app-main');
      if (!header || !shell || !main || typeof ResizeObserver === 'undefined') return;

      let banner: HTMLElement | null = null;
      let previousBottom = 0;
      // Anchor to the main viewport, excluding its scrollbar. Neither the fixed
      // header nor the logo's height depends on the content's scroll position.
      const align = () => {
        if (!header.isConnected) return;
        const nextBanner = main.querySelector<HTMLElement>(':scope > .subscription-banner');
        if (banner !== nextBanner) {
          if (banner) resize.unobserve(banner);
          banner = nextBanner;
          if (banner) resize.observe(banner);
        }
        const bounds = main.getBoundingClientRect();
        const top = bounds.top + (banner?.getBoundingClientRect().height ?? 0);
        renderer.setStyle(header, 'top', `${top}px`);
        renderer.setStyle(header, 'left', `${bounds.left}px`);
        renderer.setStyle(header, 'width', `${main.clientWidth}px`);
        const bottom = top + header.getBoundingClientRect().height - shell.getBoundingClientRect().top;
        if (bottom > 0 && bottom !== previousBottom) {
          previousBottom = bottom;
          renderer.setStyle(shell, '--shell-header-bottom', `${bottom}px`, RendererStyleFlags2.DashCase);
        }
      };
      const resize = new ResizeObserver(align);
      const notices = new MutationObserver(align);
      resize.observe(header);
      resize.observe(main);
      notices.observe(main, { childList: true });
      align();
      destroy.onDestroy(() => { resize.disconnect(); notices.disconnect(); });
    });
  }

  @Input() title = '';
  @Input() customHeading = false;
  @Input() flexible = false;
  @Input() breadcrumb: string[] = [];

  state = inject(StateService);
  private router = inject(Router);
  private readonly resources = inject(ResourceReadsService);
  private readonly bell = viewChild.required<ElementRef<HTMLButtonElement>>('bell');

  showDropdown = signal(false);

  /** El punto rojo marca NO LEÍDAS — antes se encendía con solo tener alertas, aunque ya estuvieran todas leídas. */
  hasUnread = computed(
    () =>
      this.state.notificationsCount() > 0 ||
      this.state.recentAlerts().some((a) => !a.read),
  );

  toggleDropdown(): void {
    const opening = !this.showDropdown();
    this.showDropdown.set(opening);
    if (opening) void this.loadRecentAlerts();
  }

  private async loadRecentAlerts(): Promise<void> {
    if (
      this.state.currentRole() === 'A' ||
      this.state.recentAlertsLoaded() ||
      this.state.recentAlertsLoading()
    )
      return;
    this.state.recentAlertsLoading.set(true);
    try {
      this.state.recentAlerts.set(
        await this.resources.listAlertsForUser(undefined, 6),
      );
      this.state.recentAlertsLoaded.set(true);
    } catch (error) {
      console.error('Error cargando alertas recientes', error);
    } finally {
      this.state.recentAlertsLoading.set(false);
    }
  }

  closeDropdown(): void {
    this.showDropdown.set(false);
  }

  goToMessages(): void {
    this.closeDropdown();
    void this.router.navigate([`/${this.state.currentRole().toLowerCase()}/messages`]);
  }

  @HostListener('document:keydown.escape')
  closeWithEscape(): void {
    if (!this.showDropdown()) return;
    this.closeDropdown();
    this.bell().nativeElement.focus();
  }

  typeIcon(type: AlertType): string {
    return TYPE_ICON[type];
  }

  goToAlerts(): void {
    this.closeDropdown();
    const role = this.state.currentRole();
    const route = role === 'A' ? '/a/notifications' : `/${role.toLowerCase()}/alerts`;
    this.router.navigate([route]);
  }
}
