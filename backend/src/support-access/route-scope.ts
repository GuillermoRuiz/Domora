import { PATH_METADATA } from '@nestjs/common/constants';
import type { AppRole } from '../auth/auth.types';

/**
 * How a route relates to Domora staff (role A) access control
 * (odd/tasks/role-a-panel.md S5):
 * - `platform`: only role A can reach it (`@Roles('A')`): Domora's own back
 *   office (admins, platform metrics, completeness). Unaffected.
 * - `self`: the caller's own account or Domora's own relation with the
 *   despacho (login/2FA, own notifications and push, own GDPR rights,
 *   Domora plans and invoices). Unaffected.
 * - `tenant`: client data. Either `@Roles` includes B or C, or the route has
 *   no `@Roles` at all ("open to any authenticated role", so a tenant route
 *   reachable by role A too, e.g. `PATCH estates/:estateId`).
 */
export type RouteScope = 'platform' | 'self' | 'tenant';

/**
 * First path segments that never carry client data of a despacho. Exact
 * segment match: `notifications` is self, `issues/:id/notifications` is not.
 */
const SELF_SEGMENTS = new Set([
  'auth',
  'notifications',
  'push',
  'gdpr',
  'alerts',
  'resource-reads',
  'plans',
  'admins',
  'support-sessions',
  'staff-audit',
  // Domora's own relation with its clients, used from the role A panel:
  // «Solicitudes de alta» (contacted/dismissed) and the /a/messages inbox.
  'estate-onboarding-requests',
  'direct-messages',
]);

export function classifyRoute(
  roles: readonly AppRole[] | undefined,
  template: string,
): RouteScope {
  const first = template.split('/')[0];
  if (SELF_SEGMENTS.has(first)) return 'self';
  if (roles && roles.length > 0) {
    return roles.includes('B') || roles.includes('C') ? 'tenant' : 'platform';
  }
  return 'tenant';
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isSafeMethod(method: string): boolean {
  return SAFE_METHODS.has(method.toUpperCase());
}

/**
 * POST routes that only read and compute: each service was checked to write
 * nothing (no create/update/delete/upsert, no files, no external side effect
 * beyond read lookups). Role A may call them without a support session; they
 * are audited as reads. Checked and kept as writes: `opening-balances/
 * validate` (creates the draft set), `library/review` (marks documents
 * reviewed), `assistant/ask` (external RAG keeps the conversation),
 * `meetings/:id/heartbeat` (writes presence).
 */
const READ_ONLY_POSTS = new Set([
  // Public Catastro query + in-memory cache; reads the estate's properties.
  'estates/:estateId/catastro/lookup',
  // Interest computation over receipts, policies and accruals.
  'estates/:estateId/late-interest/preview',
  // Proposed coefficients from the m² of the properties.
  'estates/:estateId/properties/coefficients/preview-by-area',
  // Builds the convocatoria document in memory.
  'estates/:estateId/meetings/convocatoria-preview',
]);

/**
 * Reads that list estates of every despacho for role A unless `?administratorId=`
 * narrows them (odd/tasks/role-a-panel.md S1). Inside a support session the
 * filter is required: without it the answer would cross despachos.
 */
const DESPACHO_LIST_READS = new Set([
  'estates',
  'estates/overview',
  'estates/overview/export.xlsx',
]);

export function isDespachoListRead(template: string): boolean {
  return DESPACHO_LIST_READS.has(template);
}

/** A request that cannot change client data: safe methods or an allowlisted read-only POST. */
export function isReadOnlyRequest(method: string, template: string): boolean {
  if (isSafeMethod(method)) return true;
  return method.toUpperCase() === 'POST' && READ_ONLY_POSTS.has(template);
}

function segments(value: unknown): string[] {
  const parts = Array.isArray(value) ? value : [value];
  return parts
    .filter((p): p is string => typeof p === 'string')
    .flatMap((p) => p.split('/'))
    .filter((p) => p.length > 0);
}

/**
 * Route TEMPLATE of a handler from its Nest metadata (`estates/:estateId/
 * cost-centres`), without the global prefix, ids or query string. Only the
 * first path of a multi-path decorator is used.
 */
export function routeTemplate(
  controller: object | undefined,
  handler: object | undefined,
): string {
  const first = (meta: unknown) =>
    Array.isArray(meta) ? (meta[0] as unknown) : meta;
  const classPath: unknown = controller
    ? first(Reflect.getMetadata(PATH_METADATA, controller))
    : undefined;
  const handlerPath: unknown = handler
    ? first(Reflect.getMetadata(PATH_METADATA, handler))
    : undefined;
  return [...segments(classPath), ...segments(handlerPath)].join('/');
}
