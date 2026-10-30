import type { INestApplicationContext } from '@nestjs/common';
import { AdminsService } from '../../../src/admins/admins.service';
import { AuthService } from '../../../src/auth/auth.service';
import { EstatesService } from '../../../src/estates/estates.service';
import { ExternalOwnersService } from '../../../src/external-owners/external-owners.service';
import { BankAccountsService } from '../../../src/ledger/banks/bank-accounts.service';
import { PropertiesService } from '../../../src/properties/properties.service';
import { PropertyMembershipInvitesService } from '../../../src/property-memberships/property-membership-invites.service';
import { CryptoService } from '../../../src/sepa/crypto.service';

/**
 * Servicios REALES que usa F1, resueltos del contexto Nest (`strict: false`
 * porque algunos no están exportados por su módulo). Una sola resolución por
 * ejecución: si cambia una firma o un constructor, falla aquí/al compilar.
 */
export interface F1Services {
  admins: AdminsService;
  auth: AuthService;
  estates: EstatesService;
  properties: PropertiesService;
  externalOwners: ExternalOwnersService;
  invites: PropertyMembershipInvitesService;
  bankAccounts: BankAccountsService;
  crypto: CryptoService;
}

export function resolveF1Services(app: INestApplicationContext): F1Services {
  const get = <T>(token: new (...args: never[]) => T): T =>
    app.get(token, { strict: false });
  return {
    admins: get(AdminsService),
    auth: get(AuthService),
    estates: get(EstatesService),
    properties: get(PropertiesService),
    externalOwners: get(ExternalOwnersService),
    invites: get(PropertyMembershipInvitesService),
    bankAccounts: get(BankAccountsService),
    crypto: get(CryptoService),
  };
}
