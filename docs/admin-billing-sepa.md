# Despacho billing data and SEPA mandate

How a despacho (role B) maintains the data Domora invoices it with, and how it authorises Domora to charge it by SEPA direct debit (`odd/tasks/role-a-panel.md` S17).

## Configuration

| Variable | Required | Meaning |
|----------|----------|---------|
| `DOMORA_SEPA_CREDITOR_ID` | No (any environment) | Domora's SEPA creditor identifier (AT-02), e.g. `ES11ZZZB12345674`. Validated at boot by `validateEnv` (check digits over national id + country + `00`, business code excluded) and normalised to upper case without spaces. A wrong value stops the boot; an absent one only logs a warning. |

Without `DOMORA_SEPA_CREDITOR_ID`, *domiciliación* cannot be selected: the API answers 409 and the settings card says so. The creditor name and address printed on the mandate are `INVOICE_ISSUER_NAME` and `INVOICE_ISSUER_ADDRESS`.

## Endpoints

| Method | Path | Role | Notes |
|--------|------|------|-------|
| GET | `/api/v1/admin-billing/me` | B | Own despacho from the token. Billing data with the IBAN masked, the active mandate, and a fresh mandate reference with the exact order text to accept. |
| PUT | `/api/v1/admin-billing/me` | B | Razón social, NIF/CIF (check digit), domicilio, email, payment method, IBAN (check digits). No `administratorId` is accepted. |
| GET | `/api/v1/admin-billing/:administratorId/sepa-mandates` | A | Every mandate of a despacho, newest first, masked. |

Both role B endpoints skip the subscription gate, so a despacho whose payment failed can still fix its data.

## Rules

- Issued invoices never change: `AdminInvoice` keeps its own recipient snapshot (`recipient_name`, `recipient_tax_id`, `recipient_address`); corrections go through a rectificativa.
- Choosing *domiciliación* for the first time, or with a new IBAN, requires accepting the SEPA CORE order shown with Domora's creditor identifier and the mandate reference (`DOM-<8 of the despacho>-<YYYYMMDD>-<6 hex>`). The previous active mandate is revoked («Sustituido por un nuevo mandato»); only one can be active (partial unique index).
- Switching to card or transfer revokes the active mandate («Cambio de método de pago») and clears the IBAN.
- The mandate stores the IBAN encrypted with `CryptoService` (`SEPA_ENC_KEY`), the masked IBAN, the signature date, the accepting user and the exact accepted text (`sepa-core-es-v1`); no IP address or user agent.
- Every change is logged in the despacho activity (`billing_change`).
