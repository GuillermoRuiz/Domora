import type { Type } from '@angular/core';

import { DemoBannerComponent } from '../shared/components/demo-banner/demo-banner.component';
import { DemoLoginPanelComponent } from './demo-login-panel/demo-login-panel.component';

/**
 * Superficie de UI del modo demo — VERSIÓN DEMO. Sustituye a `demo-ui.ts`
 * únicamente en el build `demo` (fileReplacements de angular.json). Debe
 * exportar exactamente los mismos nombres que `demo-ui.ts`.
 */
export const DemoLoginPanel: Type<unknown> | null = DemoLoginPanelComponent;
export const DemoBanner: Type<unknown> | null = DemoBannerComponent;
