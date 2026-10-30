import type { Type } from '@angular/core';

/**
 * Superficie de UI del modo demo — VERSIÓN DE PRODUCCIÓN: no exporta nada
 * real (ni componentes, ni textos, ni credenciales).
 *
 * El build `demo` (angular.json) sustituye este fichero por `demo-ui.demo.ts`
 * vía `fileReplacements`, que exporta los mismos nombres con los componentes
 * reales. Es la ÚNICA forma fiable de que el texto "Modo demo" y las
 * credenciales no acaben en el bundle de producción: esbuild no los elimina
 * con flags ni con `import()` dinámico (spike T0.5, verificado). El control
 * real lo hace `scripts/check-bundle-demo.sh` sobre `dist/`.
 *
 * REGLA: este fichero NO debe importar nada de `demo-ui.demo.ts` ni de los
 * componentes demo. Y ambos deben mantener exactamente los mismos exports.
 */

/** Botón "Modo demo" + modal de cuentas, para la pantalla de login. */
export const DemoLoginPanel: Type<unknown> | null = null;

/** Banner "Entorno de demostración", fijo en la parte superior de la app. */
export const DemoBanner: Type<unknown> | null = null;
