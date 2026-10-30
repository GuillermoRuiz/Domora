import type { Role } from '../core/models';

export interface DemoAccount {
  role: Role;
  label: string;
  email: string;
  password: string;
}

/**
 * Cuentas del entorno demo (ver backend/prisma/demo). Contraseña pública a
 * propósito: la BD demo se restablece cada noche y no contiene datos reales.
 *
 * SOLO se importa desde componentes del módulo demo-ui.demo.ts: nunca desde
 * código común, o acabaría en el bundle de producción.
 *
 * Acoplado a `DEMO_PASSWORD` de backend/prisma/demo/phases/f0-bootstrap.ts
 * (provisional hasta T1.4: si F1 cambia las contraseñas, actualizar aquí).
 */
const DEMO_PASSWORD = 'Demo2026!';

export const DEMO_ACCOUNTS: DemoAccount[] = [
  { role: 'A', label: 'Super-admin', email: 'superadmin@demo.domora.app', password: DEMO_PASSWORD },
  { role: 'B', label: 'Gestora (administrador de fincas)', email: 'gestora@demo.domora.app', password: DEMO_PASSWORD },
  { role: 'C', label: 'Propietario al día', email: 'propietario@demo.domora.app', password: DEMO_PASSWORD },
  { role: 'C', label: 'Propietario moroso', email: 'moroso@demo.domora.app', password: DEMO_PASSWORD },
  { role: 'C', label: 'Propietario recién invitado', email: 'nuevo@demo.domora.app', password: DEMO_PASSWORD },
];
