import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';

/** The owner issues page. */
export const OWNER_ISSUES_ROUTE = '/c/incidencias';
/** The owner documents page. */
export const OWNER_DOCUMENTS_ROUTE = '/c/documentacion';

/**
 * The owner's property detail no longer has issues or documents tabs: old links land on their own pages.
 * - `?tab=issues` (with `&action=new` or `&issue=<id>`) → the issues page, opening the creation modal or that issue.
 * - `?tab=documents` (with `&doc=<id>`) → the documents page, opening that document.
 */
export const legacyOwnerTabRedirect: CanActivateFn = (route) => {
  const params = route.queryParamMap;
  const tab = params.get('tab');
  if (tab === 'issues') {
    const issueId = params.get('issue');
    const queryParams = issueId ? { issue: issueId } : params.get('action') === 'new' ? { new: '1' } : {};
    return inject(Router).createUrlTree([OWNER_ISSUES_ROUTE], { queryParams });
  }
  if (tab === 'documents') {
    const docId = params.get('doc');
    return inject(Router).createUrlTree([OWNER_DOCUMENTS_ROUTE], { queryParams: docId ? { doc: docId } : {} });
  }
  return true;
};

/**
 * «Mi comunidad» ya no muestra las incidencias: los avisos y enlaces antiguos a `/c/community?issue=<id>` (o `?tab=issues`)
 * abren esa incidencia en el módulo de Incidencias.
 */
export const legacyCommunityIssueRedirect: CanActivateFn = (route) => {
  const params = route.queryParamMap;
  const issueId = params.get('issue');
  if (!issueId && params.get('tab') !== 'issues') return true;
  return inject(Router).createUrlTree([OWNER_ISSUES_ROUTE], { queryParams: issueId ? { issue: issueId } : {} });
};

/** The id after `<prefix>` in an activity or alert feed id (`issue:<id>`, `document:<id>`), or null. */
function feedSourceId(feedId: string | null | undefined, prefix: string): string | null {
  return feedId?.startsWith(prefix) && feedId.length > prefix.length ? feedId.slice(prefix.length) : null;
}

/**
 * Query params that open one issue in the owner issues page from an activity or
 * alert id (`issue:<id>`); other ids open the page without a selected issue.
 */
export function ownerIssueQueryParams(feedId: string | null | undefined): { issue?: string } {
  const id = feedSourceId(feedId, 'issue:');
  return id ? { issue: id } : {};
}

/**
 * Query params that open one document in the owner documents page from an activity
 * id (`document:<id>`); other ids open the page without a selected document.
 */
export function ownerDocumentQueryParams(feedId: string | null | undefined): { doc?: string } {
  const id = feedSourceId(feedId, 'document:');
  return id ? { doc: id } : {};
}
