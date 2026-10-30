import { Component, ElementRef, OnChanges, OnDestroy, ViewEncapsulation, afterNextRender, input, signal, viewChild } from '@angular/core';
import type { Map as LeafletMap } from 'leaflet';
import { environment } from '../../../../../environments/environment';

/**
 * Small read-only map of the estate (Leaflet + OpenStreetMap tiles, provider
 * in `environment.mapTiles`). Leaflet is loaded on demand, only when a map is
 * shown. The marker is a CSS pin: no image assets to bundle.
 */
@Component({
  selector: 'app-estate-map',
  standalone: true,
  template: `
    <div #host class="estate-map__canvas" role="region" [attr.aria-label]="'Mapa con la ubicación de ' + label()"></div>
    @if (failed()) { <p class="estate-map__fallback">No se pudo cargar el mapa.</p> }
  `,
  styleUrl: './estate-map.component.scss',
  // Leaflet builds its DOM outside Angular's templates: its stylesheet must apply unscoped.
  encapsulation: ViewEncapsulation.None,
  host: { class: 'estate-map' },
})
export class EstateMapComponent implements OnChanges, OnDestroy {
  readonly latitude = input.required<number>();
  readonly longitude = input.required<number>();
  readonly label = input('la finca');
  readonly failed = signal(false);

  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  private map: LeafletMap | null = null;
  private rendered = false;

  constructor() {
    afterNextRender(() => {
      this.rendered = true;
      void this.draw();
    });
  }

  ngOnChanges(): void {
    if (this.rendered) void this.draw();
  }

  ngOnDestroy(): void {
    this.map?.remove();
    this.map = null;
  }

  private async draw(): Promise<void> {
    try {
      const L = await import('leaflet');
      const at: [number, number] = [this.latitude(), this.longitude()];
      this.map?.remove();
      const map = L.map(this.host().nativeElement, {
        center: at, zoom: 17, scrollWheelZoom: false, attributionControl: true,
      });
      // The site sends `Referrer-Policy: no-referrer`; OSM's tile policy asks browsers for a Referer, so only the tiles send the origin.
      L.tileLayer(environment.mapTiles.url, { attribution: environment.mapTiles.attribution, maxZoom: 19, referrerPolicy: 'strict-origin-when-cross-origin' }).addTo(map);
      L.marker(at, {
        icon: L.divIcon({ className: 'estate-map__pin', iconSize: [26, 26], iconAnchor: [13, 26], html: '<span></span>' }),
        keyboard: false,
        interactive: false,
      }).addTo(map);
      map.attributionControl.setPrefix(false);
      this.map = map;
      this.failed.set(false);
    } catch {
      this.failed.set(true);
    }
  }
}
