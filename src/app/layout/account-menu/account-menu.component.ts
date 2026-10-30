import {
  Component,
  computed,
  afterNextRender,
  ElementRef,
  HostListener,
  Injector,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { StateService } from '../../core/state.service';
import { OfficeSetupService } from '../../core/office-setup.service';
import { AvatarComponent } from '../../shared/components/avatar/avatar.component';
import { IconComponent } from '../../shared/components/icon/icon.component';

let nextMenuId = 0;

@Component({
  selector: 'app-account-menu',
  standalone: true,
  imports: [AvatarComponent, IconComponent, RouterLink],
  templateUrl: './account-menu.component.html',
  styleUrl: './account-menu.component.scss',
})
export class AccountMenuComponent {
  readonly state = inject(StateService);
  private readonly auth = inject(AuthService);
  private readonly officeSetup = inject(OfficeSetupService);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly trigger =
    viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
  private readonly menu = viewChild.required<ElementRef<HTMLElement>>('menu');
  readonly menuId = `account-menu-${++nextMenuId}`;
  readonly legalId = `${this.menuId}-legal`;
  readonly legalOpen = signal(false);
  /** Enlaces legales permanentes (LSSI art. 10): antes estaban en el pie de todas las pantallas. */
  readonly legalLinks = [
    { label: 'Privacidad', route: '/privacidad' },
    { label: 'Aviso legal', route: '/aviso-legal' },
    { label: 'Cookies', route: '/cookies' },
    { label: 'Términos y condiciones', route: '/terminos' },
  ];
  readonly open = signal(false);
  readonly opened = output<void>();
  readonly loggingOut = signal(false);

  /** Pasos de puesta en marcha del despacho por completar (solo el rol B tiene despacho propio). */
  readonly pending = computed(() => (this.state.currentRole() === 'B' ? this.officeSetup.ownPending() : 0));
  /** El propietario solo tiene «Mi perfil»: «Configuración» llevaría a la misma pantalla. */
  readonly showSettings = computed(() => this.state.currentRole() !== 'C');
  readonly triggerLabel = computed(() => (this.pending() > 0 ? 'Abrir menú de cuenta, puesta en marcha pendiente' : 'Abrir menú de cuenta'));

  toggle(): void {
    if (this.open()) this.close(true);
    else this.openMenu();
  }

  openMenu(last = false): void {
    if (!this.open()) this.opened.emit();
    this.open.set(true);
    const target = this.items().at(last ? -1 : 0);
    // Focus only once Angular has removed [hidden]: https://angular.dev/api/core/afterNextRender
    afterNextRender(
      {
        write: () => {
          if (this.open() && target?.isConnected) target.focus();
        },
      },
      { injector: this.injector },
    );
  }

  followLegalLink(): void {
    this.close();
    this.state.closeSidebar();
  }

  close(restoreFocus = false): void {
    this.open.set(false);
    this.legalOpen.set(false);
    if (restoreFocus) this.trigger().nativeElement.focus();
  }

  openSettings(): void {
    this.close(true);
    this.state.closeSidebar();
    void this.router.navigate([
      `/${this.state.currentRole().toLowerCase()}/settings`,
    ]);
  }

  toggleTheme(): void {
    this.state.toggleDarkMode();
    this.close(true);
  }

  async logout(): Promise<void> {
    if (this.loggingOut()) return;
    this.loggingOut.set(true);
    this.close(true);
    try {
      this.state.closeSidebar();
      // Deactivate the protected screen before App switches router outlets on
      // session cleanup. Always run the existing logout/revocation flow.
      await this.router.navigate(['/login']).finally(() => this.auth.logout());
    } finally {
      this.loggingOut.set(false);
    }
  }

  onTriggerKeydown(event: KeyboardEvent): void {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    this.openMenu(event.key === 'ArrowUp');
  }

  onMenuKeydown(event: KeyboardEvent): void {
    if (event.key === 'Tab') {
      this.close();
      return;
    }
    const items = this.items();
    const index = items.indexOf(
      this.document.activeElement as HTMLElement,
    );
    let next: number;
    switch (event.key) {
      case 'ArrowDown':
        next = (index + 1) % items.length;
        break;
      case 'ArrowUp':
        next = (index - 1 + items.length) % items.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = items.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    items[next]?.focus();
  }

  @HostListener('document:pointerdown', ['$event'])
  onOutsidePointer(event: Event): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node))
      this.close();
  }

  @HostListener('document:keydown.escape', ['$event'])
  onEscape(event: Event): void {
    if (!this.open()) return;
    event.preventDefault();
    event.stopPropagation();
    this.close(true);
  }

  private items(): HTMLElement[] {
    return Array.from(
      this.menu().nativeElement.querySelectorAll<HTMLElement>(
        'button:not(:disabled), .account-menu__legal-link',
      ),
    );
  }
}
