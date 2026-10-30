import { isLikelyEmail, type ValidatedRow } from './parsing.util';

export interface OwnerImportRow {
  fullName: string;
  propertyRef: string;
  taxId?: string;
  email?: string;
  phone?: string;
  postalAddress?: string;
}

export function validateOwnerRow(
  mappedRow: Record<string, string>,
  rowNumber: number,
): ValidatedRow<OwnerImportRow> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const fullName = mappedRow['fullName']?.trim();
  if (!fullName) errors.push('Falta el nombre del propietario.');

  const propertyRef = mappedRow['propertyRef']?.trim();
  if (!propertyRef) {
    errors.push('Falta la referencia de la unidad a la que vincular este propietario.');
  }

  const email = mappedRow['email']?.trim();
  if (email && !isLikelyEmail(email)) {
    warnings.push(`Email con formato dudoso: "${email}".`);
  }

  if (errors.length > 0) {
    return { rowNumber, ok: false, errors, warnings };
  }

  return {
    rowNumber,
    ok: true,
    data: {
      fullName: fullName!,
      propertyRef: propertyRef!,
      taxId: mappedRow['taxId']?.trim() || undefined,
      email: email || undefined,
      phone: mappedRow['phone']?.trim() || undefined,
      postalAddress: mappedRow['postalAddress']?.trim() || undefined,
    },
    errors,
    warnings,
  };
}
