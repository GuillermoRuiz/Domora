import type { PlanTier } from '../prisma/client';

/**
 * Catálogo de planes — fuente de verdad ÚNICA en servidor. El frontend
 * tenía dos copias divergentes (dashboard-a y suscripcion.component);
 * ambas pantallas deben consumir GET /plans a partir de la Fase 11.
 * Precios de dashboard-a (los de facturación real de gestoras).
 */
export const PLAN_PRICE: Record<PlanTier, number> = {
  BASE: 49,
  STANDARD: 129,
  PREMIUM: 249,
};

/**
 * Nombre COMERCIAL de cada plan. El código y la base de datos conservan los identificadores históricos
 * (`PlanTier`: BASE/STANDARD/PREMIUM, también en Stripe y en `administrators.plan`); el producto los llama
 * Start / Pro / Scale. La correspondencia es ordinal y es esta, en un único sitio: un cambio de nombre comercial
 * se hace aquí y en la documentación, nunca renombrando el enum ni escribiendo comparaciones con un nombre.
 */
export const PLAN_COMMERCIAL_NAME: Record<PlanTier, string> = {
  BASE: 'Start',
  STANDARD: 'Pro',
  PREMIUM: 'Scale',
};

export interface PlanUserTier {
  max: number;
  price: number;
}

export const PLAN_TIERS: Record<PlanTier, PlanUserTier[]> = {
  BASE: [
    { max: 25, price: 49 },
    { max: 50, price: 79 },
  ],
  STANDARD: [
    { max: 50, price: 99 },
    { max: 100, price: 129 },
    { max: 150, price: 169 },
  ],
  PREMIUM: [
    { max: 150, price: 199 },
    { max: 200, price: 249 },
    { max: 300, price: 329 },
  ],
};

export function netMrr(base: number, discountPct: number): number {
  return Math.round(base * (1 - discountPct / 100) * 100) / 100;
}
