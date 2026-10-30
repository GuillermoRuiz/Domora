import type { ParamMap } from '@angular/router';
import type { ReportScopeSelection } from '../../core/reporting.models';

export function reportScopeFromParams(params: ParamMap): ReportScopeSelection {
  const estateIds = [
    ...new Set(
      params
        .getAll('estateIds')
        .flatMap((value) => value.split(','))
        .filter(Boolean),
    ),
  ];
  return params.get('scopeMode') === 'selected' || params.has('estateIds')
    ? { scopeMode: 'selected', estateIds }
    : { scopeMode: 'all', estateIds: [] };
}

export function reportScopeParams(
  selection: ReportScopeSelection,
): Record<string, string> {
  return selection.scopeMode === 'all'
    ? {}
    : { scopeMode: 'selected', estateIds: selection.estateIds.join(',') };
}

export function scopeForReport(
  selection: ReportScopeSelection,
  single: boolean,
): ReportScopeSelection {
  if (!single) return selection;
  return {
    scopeMode: 'selected',
    estateIds:
      selection.scopeMode === 'selected' && selection.estateIds.length === 1
        ? selection.estateIds
        : [],
  };
}

/** Selección de Informes cuando la URL no trae ámbito: la comunidad compartida con el resto de pantallas. */
export function reportScopeFromShared(estateId: string | null): ReportScopeSelection {
  return estateId
    ? { scopeMode: 'selected', estateIds: [estateId] }
    : { scopeMode: 'all', estateIds: [] };
}

/**
 * Comunidad que Informes comparte con las demás pantallas: una sola comunidad se mantiene; Todas o varias
 * (pero no todas) pasan a «Todas». `undefined` = selección vacía, que no cambia la compartida.
 */
export function sharedEstateForReport(selection: ReportScopeSelection): string | null | undefined {
  if (selection.scopeMode === 'all') return null;
  if (selection.estateIds.length === 0) return undefined;
  return selection.estateIds.length === 1 ? selection.estateIds[0] : null;
}

export function hasReportScopeParams(params: ParamMap): boolean {
  return params.has('scopeMode') || params.has('estateIds');
}
