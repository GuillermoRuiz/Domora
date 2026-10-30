import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  parseMunicipalities,
  parseParcel,
  parseProvinces,
  parseStreets,
} from './catastro-mapper';
import {
  CatastroError,
  type CatastroParcel,
  type CatastroProvince,
  type CatastroStreet,
} from './catastro.types';

/**
 * Cliente de los servicios web LIBRES (no protegidos) del Catastro — datos
 * públicos de inmuebles: sin registro ni clave. NO expone titulares, NIF ni
 * valores catastrales (son datos protegidos que exigen certificado), y este
 * cliente tampoco los pide.
 *
 * Decisiones:
 *  - URL base configurable (`CATASTRO_BASE_URL`): el host es el histórico
 *    `ovc.catastro.meh.es`, que puede cambiar sin previo aviso.
 *  - `CATASTRO_ENABLED=false` lo apaga por completo (mismo criterio de
 *    degradación que Stripe/SMTP: la app sigue funcionando sin él).
 *  - Timeout corto y sin reintentos automáticos: el servicio limita a 7.200
 *    peticiones/hora por IP y bloquea 4 h al superarlo — reintentar a ciegas
 *    agravaría un fallo. El gestor siempre puede volver a intentarlo o dar
 *    de alta a mano.
 *  - Los parámetros se codifican con `encodeURIComponent` (%20), no con
 *    `URLSearchParams` (+): el endpoint WCF no está garantizado a decodificar
 *    el `+` como espacio.
 */

const DEFAULT_BASE_URL =
  'https://ovc.catastro.meh.es/OVCServWeb/OVCWcfCallejero/COVCCallejero.svc/json';
const TIMEOUT_MS = 10_000;

export interface AddressQuery {
  provincia: string;
  municipio: string;
  /** Sigla del tipo de vía (CL, AV, PZ…). Obligatoria: sin ella el servicio responde "no existe". */
  sigla: string;
  calle: string;
  /** Máximo 4 dígitos (límite del servicio). */
  numero: string;
}

@Injectable()
export class CatastroClient {
  private readonly logger = new Logger(CatastroClient.name);

  constructor(private readonly config: ConfigService) {}

  /** Encendido salvo que se diga lo contrario (no hay secretos que configurar). */
  private get enabled(): boolean {
    return this.config.get<string>('CATASTRO_ENABLED') !== 'false';
  }

  private get baseUrl(): string {
    const configured = this.config.get<string>('CATASTRO_BASE_URL')?.trim();
    return (configured || DEFAULT_BASE_URL).replace(/\/+$/, '');
  }

  /** Todas las unidades de una parcela a partir de su referencia catastral (14/18/20). */
  async byReference(refCat: string): Promise<CatastroParcel> {
    return parseParcel(await this.get('Consulta_DNPRC', { RefCat: refCat }));
  }

  async byAddress(q: AddressQuery): Promise<CatastroParcel> {
    return parseParcel(
      await this.get('Consulta_DNPLOC', {
        Provincia: q.provincia,
        Municipio: q.municipio,
        Sigla: q.sigla,
        Calle: q.calle,
        Numero: q.numero,
      }),
    );
  }

  async provinces(): Promise<CatastroProvince[]> {
    return parseProvinces(await this.get('ObtenerProvincias', {}));
  }

  async municipalities(provincia: string, query: string): Promise<string[]> {
    return parseMunicipalities(
      await this.get('ObtenerMunicipios', {
        Provincia: provincia,
        Municipio: query,
      }),
    );
  }

  async streets(
    provincia: string,
    municipio: string,
    query: string,
  ): Promise<CatastroStreet[]> {
    return parseStreets(
      await this.get('ObtenerCallejero', {
        Provincia: provincia,
        Municipio: municipio,
        TipoVia: '',
        NomVia: query,
      }),
    );
  }

  private async get(
    operation: string,
    params: Record<string, string>,
  ): Promise<unknown> {
    if (!this.enabled) {
      throw new CatastroError(
        'unavailable',
        'La integración con el Catastro está desactivada en este entorno.',
      );
    }
    const qs = Object.entries(params)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&');
    const url = `${this.baseUrl}/${operation}${qs ? `?${qs}` : ''}`;
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        this.logger.warn(`Catastro ${operation} respondió HTTP ${res.status}`);
        throw new CatastroError(
          'unavailable',
          `El Catastro no está disponible ahora mismo (HTTP ${res.status}).`,
        );
      }
      // El servicio ha llegado a devolver BOM UTF-8 delante del JSON.
      const text = (await res.text()).replace(/^\uFEFF/, '');
      return JSON.parse(text) as unknown;
    } catch (err) {
      if (err instanceof CatastroError) throw err;
      // Timeout, red caída, DNS o cuerpo que no es JSON (p. ej. página de error HTML).
      this.logger.warn(
        `Catastro ${operation} falló: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new CatastroError(
        'unavailable',
        'No se pudo consultar el Catastro. Inténtalo de nuevo en unos minutos o da de alta las propiedades a mano.',
      );
    }
  }
}
