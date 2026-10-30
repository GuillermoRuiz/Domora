import { DOCUMENT } from '@angular/common';
import { Component, DestroyRef, inject } from '@angular/core';

/**
 * Banner "Entorno de demostración", fijo arriba del todo. Solo es accesible
 * vía demo-ui.demo.ts (build `demo`); no importar desde código común.
 *
 * Mientras está montado publica `--demo-banner-h` en :root para que el shell
 * (app.scss) y el sidebar se desplacen su altura. Sin banner la variable no
 * existe y todos los `var(--demo-banner-h, 0px)` caen a 0px (producción
 * idéntica a antes).
 */
export const DEMO_BANNER_HEIGHT = '32px';

@Component({
  selector: 'app-demo-banner',
  standalone: true,
  templateUrl: './demo-banner.component.html',
  styleUrl: './demo-banner.component.scss',
})
export class DemoBannerComponent {
  constructor() {
    const root = inject(DOCUMENT).documentElement;
    root.style.setProperty('--demo-banner-h', DEMO_BANNER_HEIGHT);
    inject(DestroyRef).onDestroy(() => root.style.removeProperty('--demo-banner-h'));
  }
}
