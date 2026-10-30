// Entorno del build `demo` (configuración `demo` de angular.json). Sustituye a
// `environment.ts` vía fileReplacements. Es como producción, pero con la UI de
// demo activa (la UI en sí llega por el fileReplacement de demo/demo-ui.ts).
export const environment = {
  production: true,
  apiBaseUrl: '/api/v1',
  mockRoleSwitch: false,
  demoMode: true,
  // Teselas del mapa de «Datos generales» (Leaflet). Cambiar de proveedor
  // basado en OpenStreetMap (MapTiler, Stadia, Carto…) es cambiar estas dos
  // líneas y el `img-src` de la CSP en nginx.conf. La atribución es obligatoria.
  mapTiles: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',
  },
};
