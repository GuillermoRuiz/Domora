import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildAltaHashInput,
  buildAnulacionHashInput,
  computeHash,
  formatSpanishDate,
  formatTimestampWithZone,
  canonicalAmount,
} from './verifactu-hash';

/** Factura completa. Las rectificativas usarían R1..R5, aún no soportadas. */
const TIPO_FACTURA_COMPLETA = 'F1';

/** Datos de la factura necesarios para construir su registro. */
export interface InvoiceForRecord {
  id: string;
  invoiceNo: string;
  issueDate: Date;
  taxAmount: Prisma.Decimal;
  total: Prisma.Decimal;
}

/**
 * Construye y encadena los registros de facturación (RD 1007/2023).
 *
 * Dos garantías que conviene no perder de vista:
 *
 * 1. **Una cadena por NIF de obligado tributario.** La norma encadena por SIF
 *    y obligado, no por serie ni por tipo de registro: una anulación puede
 *    encadenar con el alta de otra factura.
 * 2. **Los huecos se reservan bajo bloqueo.** `reserveChainSlot` bloquea la
 *    fila de la cadena hasta el commit, de modo que dos emisiones simultáneas
 *    del mismo emisor no pueden leer la misma huella anterior. Sin eso, la
 *    cadena se bifurca y deja de probar nada.
 *
 * En esta fase los registros quedan en `pendiente`: la remisión a la AEAT
 * llega después. La cadena, en cambio, ya es definitiva — por eso se calcula
 * y persiste ahora, y no cuando haya conexión con la Agencia.
 */
@Injectable()
export class VerifactuService {
  private readonly logger = new Logger(VerifactuService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** NIF con el que Domora emite sus propias facturas. */
  get issuerTaxId(): string {
    return this.config.getOrThrow<string>('INVOICE_ISSUER_TAX_ID');
  }

  /**
   * Reserva la siguiente posición de la cadena y devuelve la huella anterior.
   *
   * El `ON CONFLICT DO UPDATE` bloquea la fila del emisor: la segunda
   * transacción concurrente espera. Y `last_hash` se devuelve SIN tocar a
   * propósito —todavía no se conoce la huella nueva—, de modo que lo que
   * retorna es la huella del registro anterior, que es justo lo que entra en
   * el cálculo.
   */
  private async reserveChainSlot(
    tx: Prisma.TransactionClient,
    issuerTaxId: string,
  ): Promise<{ seq: number; previousHash: string | null }> {
    const rows = await tx.$queryRaw<
      { last_seq: number; last_hash: string | null }[]
    >`
      INSERT INTO verifactu_chain (issuer_tax_id, last_seq, last_hash)
      VALUES (${issuerTaxId}, 1, NULL)
      ON CONFLICT (issuer_tax_id)
      DO UPDATE SET last_seq = verifactu_chain.last_seq + 1
      RETURNING last_seq, last_hash
    `;
    return { seq: rows[0].last_seq, previousHash: rows[0].last_hash };
  }

  /** Fija la huella recién calculada como nueva cabeza de la cadena. */
  private async advanceChainHead(
    tx: Prisma.TransactionClient,
    issuerTaxId: string,
    hash: string,
  ): Promise<void> {
    await tx.$executeRaw`
      UPDATE verifactu_chain SET last_hash = ${hash} WHERE issuer_tax_id = ${issuerTaxId}
    `;
  }

  /**
   * Registro de ALTA de una factura. Debe llamarse DENTRO de la misma
   * transacción que crea la factura: una factura sin su registro sería un
   * incumplimiento, y un registro sin factura rompería la trazabilidad.
   */
  async appendAlta(
    tx: Prisma.TransactionClient,
    invoice: InvoiceForRecord,
    issuerTaxId: string = this.issuerTaxId,
  ) {
    return this.appendAltaInterno(tx, invoice, issuerTaxId);
  }

  /**
   * Corrige un Alta que la AEAT ya había ACEPTADO —con errores— y que por
   * tanto sigue existiendo en su sistema. No se toca el registro anterior
   * (es inmutable): se añade uno nuevo, encadenado, con `Subsanacion=S`, que
   * es como la propia norma define la corrección de un registro que sí llegó
   * a registrarse.
   */
  async appendAltaSubsanacion(
    tx: Prisma.TransactionClient,
    invoice: InvoiceForRecord,
    issuerTaxId: string = this.issuerTaxId,
  ) {
    return this.appendAltaInterno(tx, invoice, issuerTaxId, {
      subsanacion: true,
    });
  }

  /**
   * Reenvía un Alta que la AEAT RECHAZÓ de plano: nunca llegó a registrarse,
   * así que no hay nada que corregir en su sistema —a diferencia de la
   * subsanación—. Es un Alta nueva de la misma factura, marcada
   * `RechazoPrevio=S` para que la AEAT sepa que hubo un intento anterior
   * fallido. Confirmado contra preproducción: sin este campo, reenviar
   * tal cual una factura ya rechazada no tiene forma de decir "esto ya lo
   * intenté antes".
   */
  async appendAltaTrasRechazo(
    tx: Prisma.TransactionClient,
    invoice: InvoiceForRecord,
    issuerTaxId: string = this.issuerTaxId,
  ) {
    return this.appendAltaInterno(tx, invoice, issuerTaxId, {
      rechazoPrevio: true,
    });
  }

  private async appendAltaInterno(
    tx: Prisma.TransactionClient,
    invoice: InvoiceForRecord,
    issuerTaxId: string,
    correccion?: { subsanacion?: true } | { rechazoPrevio?: true },
  ) {
    const generatedAt = new Date();
    const { seq, previousHash } = await this.reserveChainSlot(tx, issuerTaxId);

    const fields = {
      idEmisorFactura: issuerTaxId,
      numSerieFactura: invoice.invoiceNo,
      fechaExpedicionFactura: formatSpanishDate(invoice.issueDate),
      tipoFactura: TIPO_FACTURA_COMPLETA,
      cuotaTotal: canonicalAmount(invoice.taxAmount.toFixed(2)),
      importeTotal: canonicalAmount(invoice.total.toFixed(2)),
      huella: previousHash ?? '',
      fechaHoraHusoGenRegistro: formatTimestampWithZone(generatedAt),
      // Se añaden solo si aplican: no forman parte de la huella oficial
      // (buildAltaHashInput toma únicamente los campos normativos de arriba),
      // pero sí viajan en el XML y quedan en el payload para reconstruirlo.
      ...(correccion && 'subsanacion' in correccion
        ? { subsanacion: true }
        : {}),
      ...(correccion && 'rechazoPrevio' in correccion
        ? { rechazoPrevio: true }
        : {}),
    };
    const hash = computeHash(buildAltaHashInput(fields));

    const record = await tx.verifactuRecord.create({
      data: {
        issuerTaxId,
        chainSeq: seq,
        type:
          correccion && 'subsanacion' in correccion ? 'subsanacion' : 'alta',
        invoiceId: invoice.id,
        payload: fields,
        hash,
        previousHash,
        generatedAt,
      },
    });
    await this.advanceChainHead(tx, issuerTaxId, hash);
    return record;
  }

  /**
   * Registro de ANULACIÓN: deja sin efecto una factura ya registrada.
   *
   * No confundir con la rectificativa — esa es una factura nueva, de tipo
   * rectificativo, y por tanto otro registro de alta. La anulación se usa
   * cuando la operación se cancela y la factura no debió existir.
   */
  async appendAnulacion(
    tx: Prisma.TransactionClient,
    invoice: InvoiceForRecord,
    issuerTaxId: string = this.issuerTaxId,
  ) {
    return this.appendAnulacionInterno(tx, invoice, issuerTaxId);
  }

  /**
   * Anula una factura cuyo Alta la AEAT RECHAZÓ (nunca llegó a registrarse).
   * Confirmado contra preproducción: una anulación normal en este caso vuelve
   * con "No existe el registro de facturación" (código 3002), porque no hay
   * nada que anular desde el lado de la AEAT. `SinRegistroPrevio=S` es cómo
   * el propio esquema resuelve precisamente esta situación.
   */
  async appendAnulacionSinRegistroPrevio(
    tx: Prisma.TransactionClient,
    invoice: InvoiceForRecord,
    issuerTaxId: string = this.issuerTaxId,
  ) {
    return this.appendAnulacionInterno(tx, invoice, issuerTaxId, {
      sinRegistroPrevio: true,
    });
  }

  private async appendAnulacionInterno(
    tx: Prisma.TransactionClient,
    invoice: InvoiceForRecord,
    issuerTaxId: string,
    opciones?: { sinRegistroPrevio?: true },
  ) {
    const generatedAt = new Date();
    const { seq, previousHash } = await this.reserveChainSlot(tx, issuerTaxId);

    const fields = {
      idEmisorFacturaAnulada: issuerTaxId,
      numSerieFacturaAnulada: invoice.invoiceNo,
      fechaExpedicionFacturaAnulada: formatSpanishDate(invoice.issueDate),
      huella: previousHash ?? '',
      fechaHoraHusoGenRegistro: formatTimestampWithZone(generatedAt),
      // No entra en la huella oficial (buildAnulacionHashInput toma solo los
      // campos normativos de arriba); sí viaja en el XML y en el payload.
      ...(opciones?.sinRegistroPrevio ? { sinRegistroPrevio: true } : {}),
    };
    const hash = computeHash(buildAnulacionHashInput(fields));

    const record = await tx.verifactuRecord.create({
      data: {
        issuerTaxId,
        chainSeq: seq,
        type: 'anulacion',
        invoiceId: invoice.id,
        payload: fields,
        hash,
        previousHash,
        generatedAt,
      },
    });
    await this.advanceChainHead(tx, issuerTaxId, hash);
    return record;
  }

  /**
   * Recorre la cadena de un emisor y comprueba que sigue intacta:
   * numeración sin saltos, cada registro apuntando a la huella del anterior,
   * y cada huella coincidiendo con la que se obtiene al recalcularla desde
   * su propio payload.
   *
   * Detecta manipulaciones aunque quien las hiciera hubiera recalculado
   * huellas hacia adelante, porque el enlace se comprueba en ambos sentidos.
   */
  async verifyChain(issuerTaxId: string = this.issuerTaxId): Promise<{
    ok: boolean;
    checked: number;
    problems: string[];
  }> {
    const records = await this.prisma.verifactuRecord.findMany({
      where: { issuerTaxId },
      orderBy: { chainSeq: 'asc' },
    });

    const problems: string[] = [];
    let expectedPrevious: string | null = null;
    let expectedSeq = 1;

    for (const record of records) {
      if (record.chainSeq !== expectedSeq) {
        problems.push(
          `Salto en la numeración: se esperaba ${expectedSeq} y se encontró ${record.chainSeq}.`,
        );
      }
      if (record.previousHash !== expectedPrevious) {
        problems.push(
          `El registro ${record.chainSeq} no enlaza con la huella del anterior.`,
        );
      }

      const fields = record.payload as Record<string, string>;
      const input =
        record.type === 'anulacion'
          ? buildAnulacionHashInput(fields as never)
          : buildAltaHashInput(fields as never);
      if (computeHash(input) !== record.hash) {
        problems.push(
          `La huella del registro ${record.chainSeq} no coincide con sus propios datos.`,
        );
      }

      expectedPrevious = record.hash;
      expectedSeq = record.chainSeq + 1;
    }

    if (problems.length > 0) {
      this.logger.error(
        `Cadena de facturación de ${issuerTaxId} comprometida: ${problems.join(' ')}`,
      );
    }
    return { ok: problems.length === 0, checked: records.length, problems };
  }
}
