export const environment = {
  production: false,
  apiBaseUrl: 'http://localhost:3000/api/v1',
  mockRoleSwitch: true,
  demoMode: false,
  // Teselas del mapa de «Datos generales» (Leaflet). Cambiar de proveedor
  // basado en OpenStreetMap (MapTiler, Stadia, Carto…) es cambiar estas dos
  // líneas y el `img-src` de la CSP en nginx.conf. La atribución es obligatoria.
  mapTiles: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',
  },
};
