import { BadRequestException } from '@nestjs/common';
import {
  SepaPain008Service,
  type Pain008DebtorLine,
} from './sepa-pain008.service';

/**
 * `SepaPain008Service` genera el XML que se sube directamente a la banca
 * electrónica de la comunidad. Es determinista y sin dependencias (no toca
 * Prisma ni red), así que un fallo aquí es 100% culpa del código — y un XML
 * mal formado hace que el BANCO rechace la remesa ENTERA, no una línea.
 *
 * `ES90000B98765432` se calculó a mano con el mismo algoritmo ISO 7064
 * MOD 97-10 que implementa `isValidSpanishCreditorId` (nunca se genera
 * llamando al propio servicio: eso solo probaría que el código está de
 * acuerdo consigo mismo, no que el CID es válido de verdad).
 */
const VALID_CID = 'ES90000B98765432';

function service(): SepaPain008Service {
  return new SepaPain008Service();
}

function estate(
  overrides: Partial<
    Parameters<SepaPain008Service['buildRequest']>[0]['estate']
  > = {},
) {
  return {
    id: 'estate-1',
    name: 'Comunidad de Prueba',
    creditorId: VALID_CID,
    creditorIban: 'ES91 2100 0418 4502 0005 1332',
    creditorBic: 'CAIXESBBXXX',
    ...overrides,
  };
}

function debtor(overrides: Partial<Pain008DebtorLine> = {}): Pain008DebtorLine {
  return {
    endToEndId: 'DOMORA-2026-08-0001',
    amount: 42.5,
    mandateUmr: 'UMR-0001',
    mandateSignedAt: '2024-01-15',
    amendmentIndicator: false,
    seqType: 'RCUR',
    debtorNameSnapshot: 'Juan Pérez García',
    debtorIbanSnapshot: 'ES76 2100 0813 6101 2345 6789',
    ...overrides,
  };
}

function buildInput(
  overrides: {
    estate?: Partial<ReturnType<typeof estate>>;
    debtors?: Pain008DebtorLine[];
    scheme?: 'CORE' | 'B2B';
    messageId?: string;
    paymentInfoId?: string;
  } = {},
) {
  return {
    estate: estate(overrides.estate),
    scheme: overrides.scheme ?? ('CORE' as const),
    requiredCollectionDate: '2026-09-01',
    messageId: overrides.messageId ?? 'DOMORA-2026-08-abc12345',
    paymentInfoId: overrides.paymentInfoId ?? 'DOMORA-2026-08-abc12345',
    debtors: overrides.debtors ?? [debtor()],
  };
}

describe('isValidSpanishCreditorId', () => {
  const s = service();

  it('acepta un CID matemáticamente válido', () => {
    expect(s.isValidSpanishCreditorId(VALID_CID)).toBe(true);
  });

  it('rechaza longitud distinta de 16', () => {
    expect(s.isValidSpanishCreditorId('ES900')).toBe(false);
  });

  it('rechaza si no empieza por ES', () => {
    expect(s.isValidSpanishCreditorId('FR90000B98765432')).toBe(false);
  });

  it('rechaza dígitos de control no numéricos', () => {
    expect(s.isValidSpanishCreditorId('ESXX000B98765432')).toBe(false);
  });

  it('rechaza un NIF con formato incorrecto', () => {
    expect(s.isValidSpanishCreditorId('ES900001987654321')).toBe(false);
  });

  it('rechaza el mismo CID válido con un dígito cambiado (checksum roto)', () => {
    const tampered = VALID_CID.slice(0, -1) + '0';
    expect(s.isValidSpanishCreditorId(tampered)).toBe(false);
  });
});

describe('buildRequest — validación', () => {
  const s = service();

  it('no lanza con datos completos y válidos', () => {
    expect(() => s.buildRequest(buildInput())).not.toThrow();
  });

  it('exige CID configurado', () => {
    expect(() =>
      s.buildRequest(buildInput({ estate: { creditorId: null } })),
    ).toThrow(BadRequestException);
  });

  it('rechaza un CID con checksum inválido', () => {
    expect(() =>
      s.buildRequest(
        buildInput({ estate: { creditorId: 'ES00000B98765432' } }),
      ),
    ).toThrow(/CID.*inválido/);
  });

  it('exige IBAN receptor configurado', () => {
    expect(() =>
      s.buildRequest(buildInput({ estate: { creditorIban: null } })),
    ).toThrow(/IBAN receptor/);
  });

  it('exige BIC receptor configurado', () => {
    expect(() =>
      s.buildRequest(buildInput({ estate: { creditorBic: null } })),
    ).toThrow(/BIC receptor/);
  });

  it('exige al menos un deudor', () => {
    expect(() => s.buildRequest(buildInput({ debtors: [] }))).toThrow(
      /No hay líneas/,
    );
  });

  it('rechaza messageId de más de 35 caracteres', () => {
    expect(() =>
      s.buildRequest(buildInput({ messageId: 'X'.repeat(36) })),
    ).toThrow(/messageId/);
  });

  it('rechaza paymentInfoId de más de 35 caracteres', () => {
    expect(() =>
      s.buildRequest(buildInput({ paymentInfoId: 'X'.repeat(36) })),
    ).toThrow(/paymentInfoId/);
  });

  it('rechaza endToEndId de más de 35 caracteres', () => {
    expect(() =>
      s.buildRequest(
        buildInput({ debtors: [debtor({ endToEndId: 'X'.repeat(36) })] }),
      ),
    ).toThrow(/endToEndId/);
  });

  it('rechaza UMR de más de 35 caracteres', () => {
    expect(() =>
      s.buildRequest(
        buildInput({ debtors: [debtor({ mandateUmr: 'X'.repeat(36) })] }),
      ),
    ).toThrow(/UMR/);
  });

  it('rechaza nombre del deudor de más de 70 caracteres', () => {
    expect(() =>
      s.buildRequest(
        buildInput({
          debtors: [debtor({ debtorNameSnapshot: 'X'.repeat(71) })],
        }),
      ),
    ).toThrow(/Nombre deudor/);
  });

  it('quita los espacios del IBAN receptor', () => {
    const req = s.buildRequest(buildInput());
    expect(req.creditorIban).toBe('ES9121000418450200051332');
  });
});

describe('toXml — estructura del documento', () => {
  const s = service();

  function xmlFor(overrides: Parameters<typeof buildInput>[0] = {}): string {
    return s.toXml(s.buildRequest(buildInput(overrides)));
  }

  it('declara el namespace ISO 20022 pain.008.001.02', () => {
    expect(xmlFor()).toContain(
      '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.008.001.02">',
    );
  });

  it('NbOfTxs y CtrlSum de la cabecera reflejan el total de líneas e importe', () => {
    const xml = xmlFor({
      debtors: [debtor({ amount: 10 }), debtor({ amount: 22.75 })],
    });
    expect(xml).toContain('<NbOfTxs>2</NbOfTxs>');
    expect(xml).toContain('<CtrlSum>32.75</CtrlSum>');
  });

  it('un único deudor con importe entero se formatea con dos decimales', () => {
    const xml = xmlFor({ debtors: [debtor({ amount: 10 })] });
    expect(xml).toContain('<InstdAmt Ccy="EUR">10.00</InstdAmt>');
  });

  it('agrupa en un <PmtInf> por cada SeqTp — nunca los mezcla en el mismo bloque', () => {
    // Es la regla más importante del docstring del servicio: mezclar FRST y
    // RCUR en el mismo <PmtInf> es justo el tipo de error que rechaza un banco.
    const xml = xmlFor({
      debtors: [
        debtor({ seqType: 'FRST', endToEndId: 'E2E-FRST', amount: 10 }),
        debtor({ seqType: 'RCUR', endToEndId: 'E2E-RCUR-1', amount: 20 }),
        debtor({ seqType: 'RCUR', endToEndId: 'E2E-RCUR-2', amount: 5 }),
      ],
    });
    const pmtInfBlocks = xml.match(/<PmtInf>/g) ?? [];
    expect(pmtInfBlocks).toHaveLength(2);

    const frstBlock = xml.slice(
      xml.indexOf('<SeqTp>FRST</SeqTp>') - 200,
      xml.indexOf('<SeqTp>FRST</SeqTp>') + 400,
    );
    expect(frstBlock).toContain('<NbOfTxs>1</NbOfTxs>');
    expect(frstBlock).toContain('<CtrlSum>10.00</CtrlSum>');

    const rcurBlock = xml.slice(
      xml.indexOf('<SeqTp>RCUR</SeqTp>') - 200,
      xml.indexOf('<SeqTp>RCUR</SeqTp>') + 700,
    );
    expect(rcurBlock).toContain('<NbOfTxs>2</NbOfTxs>');
    expect(rcurBlock).toContain('<CtrlSum>25.00</CtrlSum>');
  });

  it('quita los espacios del IBAN del deudor', () => {
    const xml = xmlFor({
      debtors: [
        debtor({ debtorIbanSnapshot: 'ES76 2100 0813 6101 2345 6789' }),
      ],
    });
    expect(xml).toContain('<IBAN>ES7621000813610123456789</IBAN>');
    expect(xml).not.toContain('ES76 2100');
  });

  it('escapa caracteres reservados de XML en nombres', () => {
    const xml = xmlFor({
      estate: { name: 'Comunidad "Los Álamos" & Anexo' },
      debtors: [debtor({ debtorNameSnapshot: "Josep O'Brien <hijo>" })],
    });
    expect(xml).toContain('Comunidad &quot;Los Álamos&quot; &amp; Anexo');
    expect(xml).toContain('Josep O&apos;Brien &lt;hijo&gt;');
    expect(xml).not.toContain('<hijo>');
  });

  it('sin BIC del deudor, usa el fallback NOTPROVIDED exigido por el esquema', () => {
    const xml = xmlFor({ debtors: [debtor({ debtorBicSnapshot: undefined })] });
    expect(xml).toContain(
      '<DbtrAgt><FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId></DbtrAgt>',
    );
  });

  it('con BIC del deudor, lo usa en vez del fallback', () => {
    const xml = xmlFor({
      debtors: [debtor({ debtorBicSnapshot: 'BBVAESMMXXX' })],
    });
    expect(xml).toContain(
      '<DbtrAgt><FinInstnId><BIC>BBVAESMMXXX</BIC></FinInstnId></DbtrAgt>',
    );
    expect(xml).not.toContain('NOTPROVIDED');
  });

  it('sin indicador de modificación, AmdmntInd es false y no hay bloque de detalle', () => {
    const xml = xmlFor({ debtors: [debtor({ amendmentIndicator: false })] });
    expect(xml).toContain('<AmdmntInd>false</AmdmntInd>');
    expect(xml).not.toContain('AmdmntInfDtls');
  });

  it('con indicador de modificación, incluye el UMR/IBAN originales sin espacios', () => {
    // El IBAN original de una modificación también debe llegar limpio al XML
    // — mismo criterio que el IBAN del deudor actual. Con espacios, el
    // <IBAN> resultante sería inválido según ISO 20022.
    const xml = xmlFor({
      debtors: [
        debtor({
          amendmentIndicator: true,
          originalMandateUmr: 'UMR-VIEJO',
          originalDebtorIban: 'ES00 0000 0000 0000 0000 0000',
        }),
      ],
    });
    expect(xml).toContain('<AmdmntInd>true</AmdmntInd>');
    expect(xml).toContain('<OrgnlMndtId>UMR-VIEJO</OrgnlMndtId>');
    expect(xml).toContain(
      '<OrgnlDbtrAcct><Id><IBAN>ES0000000000000000000000</IBAN></Id></OrgnlDbtrAcct>',
    );
  });

  it('sin texto de remesa, no incluye el bloque RmtInf', () => {
    const xml = xmlFor({ debtors: [debtor({ remittanceInfo: undefined })] });
    expect(xml).not.toContain('RmtInf');
  });

  it('con texto de remesa, lo incluye tal cual (escapado)', () => {
    const xml = xmlFor({
      debtors: [debtor({ remittanceInfo: 'Cuota agosto' })],
    });
    expect(xml).toContain('<RmtInf><Ustrd>Cuota agosto</Ustrd></RmtInf>');
  });

  it('el esquema (CORE/B2B) se refleja en LclInstrm', () => {
    expect(xmlFor({ scheme: 'B2B' })).toContain(
      '<LclInstrm><Cd>B2B</Cd></LclInstrm>',
    );
    expect(xmlFor({ scheme: 'CORE' })).toContain(
      '<LclInstrm><Cd>CORE</Cd></LclInstrm>',
    );
  });
});
