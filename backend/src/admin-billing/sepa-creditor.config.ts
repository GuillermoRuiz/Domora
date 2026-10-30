import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SEPA_CREDITOR_ID_ENV } from './sepa-mandate';

/**
 * Domora as SEPA creditor: its creditor identifier (`DOMORA_SEPA_CREDITOR_ID`,
 * validated and normalised by `validateEnv`, optional) and the issuer name and
 * address already used on its invoices. `creditorId: null` means domiciliación
 * cannot be offered.
 */
@Injectable()
export class SepaCreditorConfig {
  readonly creditorId: string | null;
  readonly creditorName: string;
  readonly creditorAddress: string;

  constructor(config: ConfigService) {
    this.creditorId = config.get<string>(SEPA_CREDITOR_ID_ENV)?.trim() || null;
    this.creditorName = config.get<string>('INVOICE_ISSUER_NAME') ?? '';
    this.creditorAddress = config.get<string>('INVOICE_ISSUER_ADDRESS') ?? '';
  }
}
