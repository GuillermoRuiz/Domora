import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { AdminInvoice, VerifactuRecord } from '../prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { canonicalAmount } from './verifactu-hash';
import {
  parseRespuesta,
  VerifactuSoapFault,
  estadoRegistroAEstado,
  type LineaRespuesta,
} from './verifactu-response';
import {
  VerifactuSoapClient,
  VerifactuTransportError,
} from './verifactu-soap.client';
import {
  CALIFICACION_SUJETA_NO_EXENTA,
  CLAVE_REGIMEN_GENERAL,
  IMPUESTO_IVA,
  regFactuXml,
  soapEnvelope,
  type Cabecera,
  type Encadenamiento,
  type RegistroFactura,
  type SistemaInformatico,
} from './verifactu-xml';

/**
 * Remisión de los registros pendientes a la AEAT.
 *
 * La propiedad que gobierna todo el diseño es que **los registros van
 * encadenados, así que se remiten en orden estricto y el proceso se detiene
 * ante el primer rechazo**. Si el registro N se rechaza, la AEAT no tiene su
 * huella; el N+1 la declara como huella anterior y sería rechazado también, y
 * así en cascada. Seguir enviando no arregla nada y ensucia el expediente con
 * una ristra de rechazos. La salida correcta es un registro de subsanación,
 * que exige intervención: por eso aquí se para y se avisa.
 *
 * Lo que NO se hace, deliberadamente: reintentar un registro que la AEAT
 * aceptó con errores. Está registrado; reenviarlo produce un duplicado.
 *
 * El envío está desacoplado de la emisión a propósito. La cadena se calcula y
 * persiste al emitir la factura, dentro de su transacción; la remisión ocurre
 * después. Así una caída del servicio de la AEAT nunca impide facturar —cosa
 * que la propia norma contempla— ni deja una factura sin registro.
 */

/** Cuántos registros se agrupan en un envío. El esquema admite hasta 1000. */
const TAMANO_LOTE = 100;

/** Espera mínima entre envíos si la AEAT no indica otra cosa. */
const ESPERA_POR_DEFECTO_S = 60;

/** A partir de aquí se deja de reintentar y se pide intervención. */
const MAX_INTENTOS = 10;

/** Campos de identificación de una factura dentro de la cadena. */
interface Identidad {
  idEmisorFactura: string;
  numSerieFactura: string;
  fechaExpedicionFactura: string;
}

type RegistroConFactura = VerifactuRecord & { invoice: AdminInvoice | null };

@Injectable()
export class VerifactuSubmissionService {
  private readonly logger = new Logger(VerifactuSubmissionService.name);

  /**
   * Instante antes del cual no se puede volver a enviar, por emisor. La AEAT
   * devuelve `TiempoEsperaEnvio` en cada respuesta y no es una sugerencia:
   * ignorarlo lleva a que rechace por exceso de frecuencia.
   */
  private readonly esperaHasta = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly soap: VerifactuSoapClient,
  ) {}

  private sistemaInformatico(): SistemaInformatico {
    return {
      productor: {
        nombreRazon: this.config.getOrThrow<string>('INVOICE_ISSUER_NAME'),
        nif: this.config.getOrThrow<string>('INVOICE_ISSUER_TAX_ID'),
      },
      nombreSistemaInformatico: this.config.get<string>(
        'VERIFACTU_SIF_NOMBRE',
        'Domora',
      ),
      idSistemaInformatico: this.config.get<string>('VERIFACTU_SIF_ID', '01'),
      version: this.config.get<string>('VERIFACTU_SIF_VERSION', '1.0'),
      numeroInstalacion: this.config.get<string>(
        'VERIFACTU_SIF_INSTALACION',
        'DOMORA-1',
      ),
      soloVerifactu: true,
      // El sistema puede usarse para varios obligados (facturación por cuenta
      // de las gestoras), pero hoy solo se usa para el propio.
      multiObligado: true,
      usandoMultiObligado: false,
    };
  }

  /** Identidad de la factura de un registro, sea alta o anulación. */
  private static identidad(record: VerifactuRecord): Identidad {
    const p = record.payload as Record<string, string>;
    return {
      idEmisorFactura:
        p['idEmisorFactura'] ?? p['idEmisorFacturaAnulada'] ?? '',
      numSerieFactura:
        p['numSerieFactura'] ?? p['numSerieFacturaAnulada'] ?? '',
      fechaExpedicionFactura:
        p['fechaExpedicionFactura'] ?? p['fechaExpedicionFacturaAnulada'] ?? '',
    };
  }

  /**
   * Traduce un registro persistido al XML.
   *
   * Los campos normativos salen del `payload`, que es inmutable y es
   * exactamente lo que entró en el cálculo de la huella. Los descriptivos
   * (concepto, desglose, destinatario) salen de la factura, que también es
   * inmutable: no hay riesgo de que diverjan.
   */
  private aRegistroFactura(
    record: RegistroConFactura,
    anterior: Encadenamiento,
  ): RegistroFactura {
    // El payload mezcla campos normativos (siempre texto) con las banderas
    // opcionales de corrección (subsanacion/rechazoPrevio/sinRegistroPrevio),
    // que son booleanas: se leen aparte, sin fingir que todo es string.
    const raw = record.payload as Record<string, unknown>;
    const p = raw as Record<string, string>;

    if (record.type === 'anulacion') {
      return {
        tipo: 'anulacion',
        datos: {
          idEmisorFacturaAnulada: p['idEmisorFacturaAnulada'],
          numSerieFacturaAnulada: p['numSerieFacturaAnulada'],
          fechaExpedicionFacturaAnulada: p['fechaExpedicionFacturaAnulada'],
          sinRegistroPrevio: raw['sinRegistroPrevio'] === true || undefined,
          encadenamiento: anterior,
          fechaHoraHusoGenRegistro: p['fechaHoraHusoGenRegistro'],
          huella: record.hash,
        },
      };
    }

    const invoice = record.invoice;
    if (!invoice) {
      throw new Error(
        `El registro de alta ${record.chainSeq} no tiene factura asociada: no se puede componer el desglose.`,
      );
    }

    return {
      tipo: 'alta',
      datos: {
        idEmisorFactura: p['idEmisorFactura'],
        numSerieFactura: p['numSerieFactura'],
        fechaExpedicionFactura: p['fechaExpedicionFactura'],
        nombreRazonEmisor: this.config.getOrThrow<string>(
          'INVOICE_ISSUER_NAME',
        ),
        subsanacion: record.type === 'subsanacion' || undefined,
        rechazoPrevio: raw['rechazoPrevio'] === true || undefined,
        tipoFactura: p['tipoFactura'],
        fechaOperacion: undefined,
        descripcionOperacion: invoice.concept || 'Servicios prestados',
        destinatarios: [
          {
            nombreRazon: invoice.recipientName,
            nif: invoice.recipientTaxId,
          },
        ],
        desglose: [
          {
            impuesto: IMPUESTO_IVA,
            claveRegimen: CLAVE_REGIMEN_GENERAL,
            calificacionOperacion: CALIFICACION_SUJETA_NO_EXENTA,
            tipoImpositivo: canonicalAmount(invoice.taxRate.toFixed(2)),
            baseImponible: canonicalAmount(invoice.taxBase.toFixed(2)),
            cuotaRepercutida: canonicalAmount(invoice.taxAmount.toFixed(2)),
          },
        ],
        cuotaTotal: p['cuotaTotal'],
        importeTotal: p['importeTotal'],
        encadenamiento: anterior,
        fechaHoraHusoGenRegistro: p['fechaHoraHusoGenRegistro'],
        huella: record.hash,
      },
    };
  }

  /** Empareja una línea de la respuesta con el registro que la originó. */
  private static casa(record: VerifactuRecord, linea: LineaRespuesta): boolean {
    const id = VerifactuSubmissionService.identidad(record);
    return (
      id.numSerieFactura === linea.numSerieFactura &&
      id.idEmisorFactura === linea.idEmisorFactura
    );
  }

  /**
   * Remite el siguiente lote pendiente de un emisor.
   *
   * @returns cuántos registros quedaron aceptados, o `null` si no había nada
   * que enviar o tocaba esperar.
   */
  async flushIssuer(issuerTaxId: string): Promise<number | null> {
    if (!this.soap.enabled) return null;

    const espera = this.esperaHasta.get(issuerTaxId) ?? 0;
    if (Date.now() < espera) return null;

    const pendientes = await this.prisma.verifactuRecord.findMany({
      where: {
        issuerTaxId,
        submissionState: 'pendiente',
        attempts: { lt: MAX_INTENTOS },
      },
      orderBy: { chainSeq: 'asc' },
      take: TAMANO_LOTE,
      include: { invoice: true },
    });
    if (pendientes.length === 0) return null;

    // El encadenamiento del primero del lote necesita la identidad del
    // registro inmediatamente anterior, que ya no está pendiente. Los demás
    // encadenan con su predecesor dentro del propio lote.
    const anterior = pendientes[0].previousHash
      ? await this.prisma.verifactuRecord.findFirst({
          where: { issuerTaxId, chainSeq: pendientes[0].chainSeq - 1 },
        })
      : null;

    if (pendientes[0].previousHash && !anterior) {
      this.logger.error(
        `Falta el registro ${pendientes[0].chainSeq - 1} de ${issuerTaxId}: la cadena está incompleta y no se remite nada.`,
      );
      return null;
    }

    const registros: RegistroFactura[] = [];
    let previo: VerifactuRecord | null = anterior;
    for (const record of pendientes) {
      const encadenamiento: Encadenamiento = previo
        ? {
            ...VerifactuSubmissionService.identidad(previo),
            huella: previo.hash,
          }
        : 'primero';
      registros.push(this.aRegistroFactura(record, encadenamiento));
      previo = record;
    }

    const cabecera: Cabecera = {
      obligado: {
        nombreRazon: this.config.getOrThrow<string>('INVOICE_ISSUER_NAME'),
        nif: issuerTaxId,
      },
    };

    const envelope = soapEnvelope(
      regFactuXml(cabecera, registros, this.sistemaInformatico()),
    );

    let xml: string;
    try {
      ({ xml } = await this.soap.post(envelope));
    } catch (error) {
      await this.anotarIntentoFallido(pendientes, error);
      return null;
    }

    let respuesta;
    try {
      respuesta = parseRespuesta(xml);
    } catch (error) {
      // Un Fault no dice nada del estado de cada registro: se deja todo
      // pendiente para reintentar, que es lo seguro.
      await this.anotarIntentoFallido(pendientes, error);
      return null;
    }

    this.esperaHasta.set(
      issuerTaxId,
      Date.now() +
        (respuesta.tiempoEsperaSegundos || ESPERA_POR_DEFECTO_S) * 1000,
    );

    let aceptados = 0;
    let rechazado: VerifactuRecord | undefined;

    for (const record of pendientes) {
      const linea = respuesta.lineas.find((l) =>
        VerifactuSubmissionService.casa(record, l),
      );
      if (!linea) {
        // Sin línea no sabemos qué pasó con él: sigue pendiente.
        continue;
      }

      const estado = estadoRegistroAEstado(linea.estado);
      await this.prisma.verifactuRecord.update({
        where: { id: record.id },
        data: {
          submissionState: estado,
          aeatCsv: respuesta.csv,
          // Se guarda la línea tal cual la devolvió la AEAT: es la prueba de
          // qué contestó exactamente y con qué código, que es justo lo que
          // hará falta si algún día hay que justificar un registro.
          aeatResponse: { ...linea },
          submittedAt: new Date(),
          attempts: { increment: 1 },
        },
      });

      if (estado === 'rechazado') {
        rechazado ??= record;
      } else {
        aceptados++;
      }
      if (estado === 'aceptado_con_errores') {
        this.logger.warn(
          `Registro ${record.chainSeq} de ${issuerTaxId} aceptado CON ERRORES (${linea.codigoError ?? 's/c'}: ${linea.descripcionError ?? 'sin descripción'}). Queda registrado en la AEAT: no se reenvía, se corrige con una subsanación.`,
        );
      }
    }

    if (rechazado) {
      this.logger.error(
        `Registro ${rechazado.chainSeq} de ${issuerTaxId} RECHAZADO. Se detiene la remisión de esta cadena: los siguientes declaran su huella como anterior y serían rechazados en cascada. Requiere subsanación.`,
      );
    }

    return aceptados;
  }

  /** Suma un intento y deja los registros pendientes para el siguiente ciclo. */
  private async anotarIntentoFallido(
    registros: VerifactuRecord[],
    error: unknown,
  ): Promise<void> {
    const reintentable =
      error instanceof VerifactuTransportError ? error.retryable : true;
    const motivo =
      error instanceof VerifactuTransportError ||
      error instanceof VerifactuSoapFault
        ? error.message
        : String(error);

    await this.prisma.verifactuRecord.updateMany({
      where: { id: { in: registros.map((r) => r.id) } },
      data: { attempts: { increment: 1 } },
    });

    const nivel = reintentable ? 'warn' : 'error';
    this.logger[nivel](
      `Envío de ${registros.length} registro(s) fallido: ${motivo}${reintentable ? ' — se reintentará.' : ''}`,
    );
  }

  /**
   * Remite lo pendiente de todos los emisores con registros en cola.
   *
   * Se consulta qué emisores tienen pendientes en lugar de asumir uno solo:
   * la cadena es multi-emisor desde el diseño, y en preproducción el emisor
   * es el titular del certificado, distinto del de producción.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async flush(): Promise<void> {
    if (!this.soap.enabled) return;

    try {
      const emisores = await this.prisma.verifactuRecord.groupBy({
        by: ['issuerTaxId'],
        where: {
          submissionState: 'pendiente',
          attempts: { lt: MAX_INTENTOS },
        },
      });

      for (const { issuerTaxId } of emisores) {
        await this.flushIssuer(issuerTaxId);
      }
    } catch (error) {
      // El cron nunca debe tumbar el proceso: lo pendiente sigue pendiente.
      this.logger.error('Error en el ciclo de remisión a la AEAT', error);
    }
  }
}
