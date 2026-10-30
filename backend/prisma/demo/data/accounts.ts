import { DEMO_EMAIL_DOMAIN } from '../guard';

/**
 * FUENTE ÚNICA de las cuentas de acceso del entorno demo (T1.4).
 *
 * El front las replica en `src/app/demo/demo-accounts.ts` (bundle demo); un
 * spec del backend (`demo-accounts-sync.spec.ts`) lee ese fichero y falla si
 * los emails o la contraseña dejan de coincidir con estos.
 *
 * Contraseña PÚBLICA a propósito (la BD demo está aislada, sin datos reales y
 * se restablece cada noche). Es distinta de las del seed mínimo de CI
 * (admin123 / owner123 / super123), que no deben aparecer en el bundle.
 */
export const DEMO_PASSWORD = 'Demo2026!';

export type DemoAccountKey =
  'superadmin' | 'gestora' | 'propietario' | 'moroso' | 'nuevo';

export interface DemoAccountSpec {
  key: DemoAccountKey;
  email: string;
  role: 'A' | 'B' | 'C';
  /** Nombre visible en la aplicación (persona real-looking). */
  fullName: string;
}

export const DEMO_ACCOUNT_SPECS: readonly DemoAccountSpec[] = [
  {
    key: 'superadmin',
    email: `superadmin${DEMO_EMAIL_DOMAIN}`,
    role: 'A',
    fullName: 'Laura Vidal Ortega',
  },
  {
    key: 'gestora',
    email: `gestora${DEMO_EMAIL_DOMAIN}`,
    role: 'B',
    fullName: 'Isabel Moreno Castelló',
  },
  {
    key: 'propietario',
    email: `propietario${DEMO_EMAIL_DOMAIN}`,
    role: 'C',
    fullName: 'Marta Soler Giménez',
  },
  {
    key: 'moroso',
    email: `moroso${DEMO_EMAIL_DOMAIN}`,
    role: 'C',
    fullName: 'Antonio Pérez Lorente',
  },
  {
    key: 'nuevo',
    email: `nuevo${DEMO_EMAIL_DOMAIN}`,
    role: 'C',
    fullName: 'Lucía Navarro Campos',
  },
];

export function accountSpec(key: DemoAccountKey): DemoAccountSpec {
  const spec = DEMO_ACCOUNT_SPECS.find((a) => a.key === key);
  if (!spec) throw new Error(`Cuenta demo desconocida: ${key}`);
  return spec;
}
