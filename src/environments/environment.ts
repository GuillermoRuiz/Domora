// Entorno de producción (build por defecto). `environment.development.ts` lo
// sustituye en `ng serve` / configuración `development` vía fileReplacements
// (angular.json).
export const environment = {
  production: true,
  apiBaseUrl: '/api/v1',
  // Selector de rol visible en la cabecera (StateService.cycleRole) — solo
  // tiene sentido mientras no hay backend de roles múltiples por usuario;
  // se desactiva en producción.
  mockRoleSwitch: false,
  // true solo en el build `demo` (environment.demo.ts). La UI y las credenciales
  // de demo NO dependen de esta flag (no se eliminarían del bundle): viven en
  // demo/demo-ui.demo.ts, sustituido por fileReplacements.
  demoMode: false,
  // Teselas del mapa de «Datos generales» (Leaflet). Cambiar de proveedor
  // basado en OpenStreetMap (MapTiler, Stadia, Carto…) es cambiar estas dos
  // líneas y el `img-src` de la CSP en nginx.conf. La atribución es obligatoria.
  mapTiles: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',
  },
};
