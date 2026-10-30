import { BadRequestException, Injectable } from '@nestjs/common';
import type { MandateSeq, SepaScheme } from '../prisma/client';

/**
 * Generador de XML pain.008.001.02 para SDD (SEPA Direct Debit) — port
 * casi 1:1 del prototipo Angular (src/app/core/sepa-pain008.service.ts),
 * re-implementado en servidor por decisión de la Fase 6: el XML final
 * contiene los IBAN de todos los propietarios y debe generarse en un
 * entorno controlado, con datos leídos de la base de datos (no de lo que
 * el cliente afirme).
 *
 * Cumple ISO 20022 pain.008.001.02 y Cuaderno 19.14 (AEB). Reglas:
 *   - Un `<PmtInf>` por secuencia (FRST/RCUR/OOFF/FNAL).
 *   - Importes con punto decimal y 2 decimales.
 *   - Todos los datos del deudor son SNAPSHOTS al momento de emitir.
 */

export interface Pain008DebtorLine {
  endToEndId: string; // ≤35 chars
  amount: number; // euros, 2 decimales
  mandateUmr: string; // ≤35 chars
  mandateSignedAt: string; // YYYY-MM-DD
  amendmentIndicator: boolean;
  seqType: MandateSeq;
  debtorNameSnapshot: string;
  debtorIbanSnapshot: string;
  debtorBicSnapshot?: string;
  remittanceInfo?: string;
  originalMandateUmr?: string;
  originalDebtorIban?: string;
}

export interface Pain008Request {
  messageId: string;
  creationDateTime: string;
  initiatingPartyName: string;
  paymentInfoId: string;
  requiredCollectionDate: string;
  scheme: SepaScheme;
  creditorName: string;
  creditorIban: string;
  creditorBic: string;
  creditorId: string;
  debtors: Pain008DebtorLine[];
}

@Injectable()
export class SepaPain008Service {
  /**
   * Validación de CID español (ISO 7064 mod 97-10) — control FINAL en
   * servidor; la validación en cliente queda solo como feedback de UX.
   */
  isValidSpanishCreditorId(cid: string): boolean {
    if (cid.length !== 16) return false;
    if (!cid.startsWith('ES')) return false;
    const check = cid.slice(2, 4);
    if (!/^\d{2}$/.test(check)) return false;
    const nif = cid.slice(7);
    if (!/^[A-Z]\d{7}[A-Z0-9]$/.test(nif)) return false;

    const rearranged = nif + 'ES' + check;
    let remainder = 0;
    for (const ch of rearranged) {
      const digits = /^\d$/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
      for (const digit of digits) {
        remainder = (remainder * 10 + Number(digit)) % 97;
      }
    }
    return remainder === 1;
  }

  buildRequest(input: {
    estate: {
      id: string;
      name: string;
      creditorId: string | null;
      creditorIban: string | null; // ya DESCIFRADO por el llamante
      creditorBic: string | null;
    };
    scheme: SepaScheme;
    requiredCollectionDate: string;
    messageId: string;
    paymentInfoId: string;
    debtors: Pain008DebtorLine[];
  }): Pain008Request {
    const { estate } = input;
    if (!estate.creditorId) {
      throw new BadRequestException(
        'La comunidad no tiene CID SEPA configurado.',
      );
    }
    if (!this.isValidSpanishCreditorId(estate.creditorId)) {
      throw new BadRequestException(
        `CID de la comunidad inválido: ${estate.creditorId}`,
      );
    }
    if (!estate.creditorIban) {
      throw new BadRequestException(
        'La comunidad no tiene IBAN receptor configurado.',
      );
    }
    if (!estate.creditorBic) {
      throw new BadRequestException(
        'La comunidad no tiene BIC receptor configurado.',
      );
    }
    if (input.debtors.length === 0) {
      throw new BadRequestException('No hay líneas para incluir en la remesa.');
    }
    if (input.messageId.length > 35) {
      throw new BadRequestException('messageId excede 35 caracteres.');
    }
    if (input.paymentInfoId.length > 35) {
      throw new BadRequestException('paymentInfoId excede 35 caracteres.');
    }
    for (const d of input.debtors) {
      if (d.endToEndId.length > 35) {
        throw new BadRequestException(
          `endToEndId excede 35 chars: ${d.endToEndId}`,
        );
      }
      if (d.mandateUmr.length > 35) {
        throw new BadRequestException(`UMR excede 35 chars: ${d.mandateUmr}`);
      }
      if (d.debtorNameSnapshot.length > 70) {
        throw new BadRequestException(
          `Nombre deudor excede 70 chars: ${d.debtorNameSnapshot}`,
        );
      }
    }

    return {
      messageId: input.messageId,
      creationDateTime: new Date().toISOString(),
      initiatingPartyName: estate.name,
      paymentInfoId: input.paymentInfoId,
      requiredCollectionDate: input.requiredCollectionDate,
      scheme: input.scheme,
      creditorName: estate.name,
      creditorIban: estate.creditorIban.replace(/\s/g, ''),
      creditorBic: estate.creditorBic,
      creditorId: estate.creditorId,
      debtors: input.debtors,
    };
  }

  toXml(req: Pain008Request): string {
    const controlSum = req.debtors.reduce((s, d) => s + d.amount, 0).toFixed(2);
    const nbOfTxs = req.debtors.length;

    const bySeq = new Map<MandateSeq, Pain008DebtorLine[]>();
    for (const d of req.debtors) {
      const arr = bySeq.get(d.seqType) ?? [];
      arr.push(d);
      bySeq.set(d.seqType, arr);
    }

    const pmtInfBlocks = Array.from(bySeq.entries())
      .map(([seq, lines], idx) => {
        const blockSum = lines.reduce((s, l) => s + l.amount, 0).toFixed(2);
        const txs = lines.map((l) => this.renderDebtorTx(l)).join('\n');
        return `
    <PmtInf>
      <PmtInfId>${escapeXml(req.paymentInfoId)}-${seq}-${idx}</PmtInfId>
      <PmtMtd>DD</PmtMtd>
      <NbOfTxs>${lines.length}</NbOfTxs>
      <CtrlSum>${blockSum}</CtrlSum>
      <PmtTpInf>
        <SvcLvl><Cd>SEPA</Cd></SvcLvl>
        <LclInstrm><Cd>${req.scheme}</Cd></LclInstrm>
        <SeqTp>${seq}</SeqTp>
      </PmtTpInf>
      <ReqdColltnDt>${req.requiredCollectionDate}</ReqdColltnDt>
      <Cdtr><Nm>${escapeXml(req.creditorName)}</Nm></Cdtr>
      <CdtrAcct><Id><IBAN>${req.creditorIban}</IBAN></Id></CdtrAcct>
      <CdtrAgt><FinInstnId><BIC>${req.creditorBic}</BIC></FinInstnId></CdtrAgt>
      <ChrgBr>SLEV</ChrgBr>
      <CdtrSchmeId><Id><PrvtId><Othr><Id>${req.creditorId}</Id><SchmeNm><Prtry>SEPA</Prtry></SchmeNm></Othr></PrvtId></Id></CdtrSchmeId>
${txs}
    </PmtInf>`;
      })
      .join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.008.001.02">
  <CstmrDrctDbtInitn>
    <GrpHdr>
      <MsgId>${escapeXml(req.messageId)}</MsgId>
      <CreDtTm>${req.creationDateTime}</CreDtTm>
      <NbOfTxs>${nbOfTxs}</NbOfTxs>
      <CtrlSum>${controlSum}</CtrlSum>
      <InitgPty><Nm>${escapeXml(req.initiatingPartyName)}</Nm></InitgPty>
    </GrpHdr>${pmtInfBlocks}
  </CstmrDrctDbtInitn>
</Document>`;
  }

  private renderDebtorTx(l: Pain008DebtorLine): string {
    const amendmentBlock = l.amendmentIndicator
      ? `
          <AmdmntInd>true</AmdmntInd>
          <AmdmntInfDtls>
            ${l.originalMandateUmr ? `<OrgnlMndtId>${escapeXml(l.originalMandateUmr)}</OrgnlMndtId>` : ''}
            ${l.originalDebtorIban ? `<OrgnlDbtrAcct><Id><IBAN>${l.originalDebtorIban.replace(/\s/g, '')}</IBAN></Id></OrgnlDbtrAcct>` : ''}
          </AmdmntInfDtls>`
      : '<AmdmntInd>false</AmdmntInd>';
    const debtorBicBlock = l.debtorBicSnapshot
      ? `<DbtrAgt><FinInstnId><BIC>${l.debtorBicSnapshot}</BIC></FinInstnId></DbtrAgt>`
      : '<DbtrAgt><FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId></DbtrAgt>';
    return `      <DrctDbtTxInf>
        <PmtId><EndToEndId>${escapeXml(l.endToEndId)}</EndToEndId></PmtId>
        <InstdAmt Ccy="EUR">${l.amount.toFixed(2)}</InstdAmt>
        <DrctDbtTx>
          <MndtRltdInf>
            <MndtId>${escapeXml(l.mandateUmr)}</MndtId>
            <DtOfSgntr>${l.mandateSignedAt}</DtOfSgntr>${amendmentBlock}
          </MndtRltdInf>
        </DrctDbtTx>
        ${debtorBicBlock}
        <Dbtr><Nm>${escapeXml(l.debtorNameSnapshot)}</Nm></Dbtr>
        <DbtrAcct><Id><IBAN>${l.debtorIbanSnapshot.replace(/\s/g, '')}</IBAN></Id></DbtrAcct>
        ${l.remittanceInfo ? `<RmtInf><Ustrd>${escapeXml(l.remittanceInfo)}</Ustrd></RmtInf>` : ''}
      </DrctDbtTxInf>`;
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
