import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { PrismaService } from '../prisma/prisma.service';

const WFS_URL = 'https://ovc.catastro.meh.es/INSPIRE/wfsBU.aspx';
const PHOTO_PATH =
  '/OVCServWeb/OVCWcfLibres/OVCFotoFachada.svc/RecuperarFotoFachadaGet';
const MAX_XML_BYTES = 2 * 1024 * 1024;

export function normalizeCadastralReference(
  value: string | null | undefined,
): { reference: string; parcelReference: string } | null {
  const reference = (value ?? '').trim().replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z0-9]{14}(?:[A-Z0-9]{4}|[A-Z0-9]{6})?$/.test(reference))
    return null;
  return { reference, parcelReference: reference.slice(0, 14) };
}

/** Only the photo endpoint observed in Catastro GML; never a client-supplied URL. */
export function validateFacadeUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.hostname !== 'ovc.catastro.meh.es' ||
      url.port ||
      url.username ||
      url.password ||
      url.pathname !== PHOTO_PATH
    )
      return null;
    if (
      !normalizeCadastralReference(url.searchParams.get('ReferenciaCatastral'))
    )
      return null;
    // The GML currently publishes HTTP; the same official endpoint was verified over HTTPS.
    url.protocol = 'https:';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function entries(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(entries);
  return value && typeof value === 'object'
    ? [value as Record<string, unknown>]
    : [];
}

@Injectable()
export class CatastroFacadeService {
  private readonly logger = new Logger(CatastroFacadeService.name);
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async resolveFacadeUrl(
    cadastralReference: string | null | undefined,
  ): Promise<string | null> {
    const ref = normalizeCadastralReference(cadastralReference);
    if (!ref || this.config.get<string>('CATASTRO_ENABLED') === 'false')
      return null;
    const url = new URL(WFS_URL);
    // Official example: https://www.catastro.hacienda.gob.es/webinspire/documentos/inspire-bu-WFS.pdf
    // Live verified: StoredQuerie_id returns Building/document/documentLink (2026-10-14).
    url.search = new URLSearchParams({
      service: 'wfs',
      version: '2.0.0',
      request: 'getfeature',
      StoredQuerie_id: 'GetBuildingByParcel',
      REFCAT: ref.parcelReference,
    }).toString();
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/gml+xml, application/xml, text/xml' },
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok || !response.body)
        throw new Error('WFS response unavailable');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > MAX_XML_BYTES) {
          await reader.cancel();
          throw new Error('WFS response too large');
        }
        chunks.push(next.value);
      }
      const buffer = Buffer.concat(chunks);
      const latin1 = /encoding=["']ISO-8859-1["']/i.test(
        buffer.subarray(0, 150).toString('ascii'),
      );
      const xml = new TextDecoder(latin1 ? 'iso-8859-1' : 'utf-8').decode(
        buffer,
      );
      if (
        /<!DOCTYPE|<!ENTITY/i.test(xml) ||
        XMLValidator.validate(xml) !== true
      )
        throw new Error('Invalid WFS XML');
      const parsed: unknown = new XMLParser({
        removeNSPrefix: true,
        parseTagValue: false,
        ignoreAttributes: true,
        processEntities: true,
      }).parse(xml);
      for (const root of entries(parsed)) {
        for (const collection of entries(root['FeatureCollection'])) {
          for (const member of entries(
            collection['featureMember'] ?? collection['member'],
          )) {
            for (const building of entries(member['Building'])) {
              for (const document of entries(building['document'])) {
                for (const detail of entries(document['Document'])) {
                  const link = detail['documentLink'];
                  const safe =
                    typeof link === 'string' ? validateFacadeUrl(link) : null;
                  if (
                    safe &&
                    new URL(safe).searchParams
                      .get('ReferenciaCatastral')
                      ?.slice(0, 14) === ref.parcelReference
                  )
                    return safe;
                }
              }
            }
          }
        }
      }
      return null;
    } catch {
      this.logger.warn(
        'No se pudo resolver la fachada oficial de Catastro; se usará el icono de edificio.',
      );
      return null;
    }
  }

  /** Compare-and-set prevents a late response overwriting a changed cadastral reference. */
  async refreshEstate(
    estateId: string,
    reference: string | null,
    strictCache = false,
  ): Promise<string | null> {
    const url = await this.resolveFacadeUrl(reference);
    try {
      await this.prisma.estate.updateMany({
        where: { id: estateId, cadastralReference: reference, deletedAt: null },
        data: {
          catastroFacadeUrl: url,
          catastroFacadeResolvedAt: reference ? new Date() : null,
        },
      });
    } catch (error) {
      if (strictCache) throw error;
      this.logger.warn(
        'No se pudo guardar la caché de fachada; la operación principal ya se completó.',
      );
      return null;
    }
    return url;
  }
}
