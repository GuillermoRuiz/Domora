import { setupComponent, settle } from '../../../../core/testing/component-harness';
import { environment } from '../../../../../environments/environment';
import { EstateMapComponent } from './estate-map.component';

describe('EstateMapComponent', () => {
  async function mount(latitude = 40.42, longitude = -3.705) {
    const h = setupComponent(EstateMapComponent);
    h.fixture.componentRef.setInput('latitude', latitude);
    h.fixture.componentRef.setInput('longitude', longitude);
    h.fixture.componentRef.setInput('label', 'Residencial Plaza');
    h.fixture.detectChanges();
    // Leaflet is imported on demand after the first render.
    for (let i = 0; i < 5 && !h.el.querySelector('.leaflet-container'); i++) await settle();
    h.fixture.detectChanges();
    return h;
  }

  it('dibuja un mapa accesible con el proveedor de teselas configurado y la atribución de OpenStreetMap', async () => {
    const h = await mount();
    expect(environment.mapTiles.url).toContain('{z}/{x}/{y}');
    expect(h.el.querySelector('[role="region"]')?.getAttribute('aria-label')).toBe('Mapa con la ubicación de Residencial Plaza');
    expect(h.el.querySelector('.leaflet-container')).not.toBeNull();
    expect(h.el.querySelector('.leaflet-control-attribution')?.textContent).toContain('OpenStreetMap');
    expect(h.el.querySelector('.estate-map__pin')).not.toBeNull();
    expect(h.el.querySelector('.estate-map__fallback')).toBeNull();
  });

  it('no permite hacer zoom con la rueda (no secuestra el scroll de la página)', async () => {
    const h = await mount();
    const map = (h.component as unknown as { map: { scrollWheelZoom: { enabled(): boolean } } }).map;
    expect(map.scrollWheelZoom.enabled()).toBe(false);
  });
});
