/** Global API prefix set in `main.ts`; tolerated if a path includes it. */
const API_PREFIX = ['api', 'v1'];

/**
 * Routes that say nothing about adoption: session plumbing (`auth`), background
 * notification/push traffic that fires while a tab is merely open, and the
 * health/root probes. A request to them neither marks the user active nor adds
 * a module.
 */
export const USAGE_IGNORED_MODULES: ReadonlySet<string> = new Set([
  'auth',
  'notifications',
  'push',
  'health',
]);

const isStatic = (segment: string | undefined): segment is string =>
  !!segment &&
  !segment.startsWith(':') &&
  !segment.startsWith('*') &&
  !segment.includes('{');

/**
 * Module key of a controller, from its own `@Controller(path)` (never the
 * handler's sub-path, so actions such as `:id/cancel` or `:id/agenda/...`
 * never become modules, and never the concrete URL, so ids never leak). Rules:
 * - first static segment, lowercased (`meetings`); an optional `/api/v1`
 *   prefix is ignored;
 * - a controller nested under a container scope counts as its own module:
 *   `estates/:estateId/receipts` → `receipts`, `users/:userId/receipts` →
 *   `receipts`, while `estates/:estateId` stays `estates`;
 * - the `me/...` namespace is skipped (`me/issues` → `issues`);
 * - noise controllers (USAGE_IGNORED_MODULES) and the root return null.
 */
export function moduleKeyFromControllerPath(
  controllerPath: string | undefined,
): string | null {
  if (!controllerPath) return null;
  let segments = controllerPath.split('/').filter(Boolean);
  if (
    segments.length >= API_PREFIX.length &&
    API_PREFIX.every((p, i) => segments[i].toLowerCase() === p)
  ) {
    segments = segments.slice(API_PREFIX.length);
  }
  if (segments[0]?.toLowerCase() === 'me') segments = segments.slice(1);

  let key = segments[0];
  if (!isStatic(key)) return null;
  if (!isStatic(segments[1]) && isStatic(segments[2])) key = segments[2];

  key = key.toLowerCase();
  return USAGE_IGNORED_MODULES.has(key) ? null : key;
}
