import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeCadastralReference } from './catastro-facade.service';

// Verified live on 2026-10-21 with RefCat 9872023VH5797S (Catastro's own example):
// Consulta_CPMRC answers xcen/ycen in EPSG:4326; the INSPIRE parcel WFS answers cp:areaValue in m².
const CATASTRO_COORDS_URL = 'https://ovc.catastro.meh.es/OVCServWeb/OVCWcfCallejero/COVCCoordenadas.svc/json/Consulta_CPMRC';
const CATASTRO_PARCEL_URL = 'https://ovc.catastro.meh.es/INSPIRE/wfsCP.aspx';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
/** Nominatim usage policy: at most one request per second, identified by User-Agent. */
const NOMINATIM_INTERVAL_MS = 1100;
const TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 512 * 1024;

export interface EstateLocation {
  latitude: number;
  longitude: number;
  source: 'catastro' | 'nominatim';
  parcelAreaM2: number | null;
}

export interface LocateInput {
  cadastralReference: string | null;
  address: string;
  streetNumber: string | null;
  postalCode: string | null;
  location: string;
  province: string | null;
}

const validCoordinates = (lat: number, lon: number) =>
  Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);

/** Locates an estate for the general-data map: Catastro by parcel reference first, Nominatim by address as fallback. */
@Injectable()
export class EstateGeoService {
  private readonly logger = new Logger(EstateGeoService.name);
  private nominatimQueue: Promise<unknown> = Promise.resolve();
  private lastNominatimAt = 0;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  /** Test seams: real time by default. */
  now = () => Date.now();
  sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

  async locate(input: LocateInput): Promise<EstateLocation | null> {
    const ref = normalizeCadastralReference(input.cadastralReference);
    if (ref && this.config.get<string>('CATASTRO_ENABLED') !== 'false') {
      const fromCatastro = await this.fromCatastro(ref.parcelReference);
      if (fromCatastro) return fromCatastro;
    }
    if (this.config.get<string>('GEOCODING_ENABLED') === 'false') return null;
    return this.fromNominatim(input);
  }

  /**
   * Stores the estate location. Compare-and-set on the address and reference that were geocoded,
   * so a late answer never overwrites an estate that changed meanwhile. Never throws.
   */
  async refreshEstate(estateId: string): Promise<void> {
    try {
      const estate = await this.prisma.estate.findFirst({
        where: { id: estateId, deletedAt: null },
        select: { cadastralReference: true, address: true, streetNumber: true, postalCode: true, location: true, province: true },
      });
      if (!estate) return;
      const found = await this.locate(estate);
      await this.prisma.estate.updateMany({
        where: { id: estateId, deletedAt: null, ...estate },
        data: found
          ? {
              latitude: found.latitude.toFixed(6), longitude: found.longitude.toFixed(6), geoSource: found.source, geoResolvedAt: new Date(),
              ...(found.parcelAreaM2 != null ? { parcelAreaM2: found.parcelAreaM2.toFixed(2) } : {}),
            }
          : { latitude: null, longitude: null, geoSource: null, geoResolvedAt: new Date() },
      });
    } catch {
      this.logger.warn('No se pudo ubicar la finca para el mapa; la tarjeta mostrará el enlace al mapa.');
    }
  }

  private async fromCatastro(parcelReference: string): Promise<EstateLocation | null> {
    try {
      const url = new URL(CATASTRO_COORDS_URL);
      url.search = new URLSearchParams({ RefCat: parcelReference, SRS: 'EPSG:4326' }).toString();
      const body = JSON.parse(await this.fetchText(url, 'application/json')) as {
        Consulta_CPMRCResult?: { coordenadas?: { coord?: { geo?: { xcen?: string; ycen?: string } }[] } };
      };
      const geo = body.Consulta_CPMRCResult?.coordenadas?.coord?.[0]?.geo;
      const latitude = Number(geo?.ycen);
      const longitude = Number(geo?.xcen);
      if (!validCoordinates(latitude, longitude)) return null;
      return { latitude, longitude, source: 'catastro', parcelAreaM2: await this.parcelArea(parcelReference) };
    } catch {
      return null;
    }
  }

  private async parcelArea(parcelReference: string): Promise<number | null> {
    try {
      const url = new URL(CATASTRO_PARCEL_URL);
      url.search = new URLSearchParams({
        service: 'wfs', version: '2.0.0', request: 'GetFeature', STOREDQUERIE_ID: 'GetParcel', refcat: parcelReference, srsname: 'EPSG::4326',
      }).toString();
      const xml = await this.fetchText(url, 'application/gml+xml, application/xml, text/xml');
      const match = /<cp:areaValue[^>]*>\s*([0-9]+(?:\.[0-9]+)?)\s*<\/cp:areaValue>/.exec(xml);
      const area = match ? Number(match[1]) : NaN;
      return Number.isFinite(area) && area > 0 ? area : null;
    } catch {
      return null;
    }
  }

  private fromNominatim(input: LocateInput): Promise<EstateLocation | null> {
    const street = [input.address, input.streetNumber].filter(Boolean).join(' ');
    const query = [street, [input.postalCode, input.location].filter(Boolean).join(' '), input.province, 'España'].filter(Boolean).join(', ');
    // Serialized queue: concurrent saves still respect one request per second.
    const run = this.nominatimQueue.then(async () => {
      const wait = this.lastNominatimAt + NOMINATIM_INTERVAL_MS - this.now();
      if (wait > 0) await this.sleep(wait);
      this.lastNominatimAt = this.now();
      try {
        const url = new URL(NOMINATIM_URL);
        url.search = new URLSearchParams({ format: 'jsonv2', limit: '1', countrycodes: 'es', q: query }).toString();
        const results = JSON.parse(await this.fetchText(url, 'application/json')) as { lat?: string; lon?: string }[];
        const latitude = Number(results?.[0]?.lat);
        const longitude = Number(results?.[0]?.lon);
        return validCoordinates(latitude, longitude) ? { latitude, longitude, source: 'nominatim' as const, parcelAreaM2: null } : null;
      } catch {
        return null;
      }
    });
    this.nominatimQueue = run.catch(() => undefined);
    return run;
  }

  private async fetchText(url: URL, accept: string): Promise<string> {
    const response = await fetch(url, {
      headers: { Accept: accept, 'User-Agent': this.config.get<string>('NOMINATIM_USER_AGENT') || 'Domora/1.0 (gestion de comunidades de propietarios)' },
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    if (text.length > MAX_BODY_BYTES) throw new Error('Response too large');
    return text;
  }
}
