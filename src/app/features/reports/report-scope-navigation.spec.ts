import { convertToParamMap } from '@angular/router';
import {
  reportScopeFromParams,
  reportScopeParams,
  scopeForReport,
  reportScopeFromShared,
  sharedEstateForReport,
} from './report-scope-navigation';

describe('report scope navigation', () => {
  it('mantiene el ámbito global en enlaces sin parámetros', () => {
    expect(reportScopeFromParams(convertToParamMap({}))).toEqual({
      scopeMode: 'all',
      estateIds: [],
    });
    expect(reportScopeParams({ scopeMode: 'all', estateIds: [] })).toEqual({});
  });
  it('conserva IDs únicos y selecciones vacías sin ampliarlas a Todas', () => {
    expect(
      reportScopeFromParams(convertToParamMap({ estateIds: 'e1,e2,e1' })),
    ).toEqual({ scopeMode: 'selected', estateIds: ['e1', 'e2'] });
    expect(
      reportScopeFromParams(
        convertToParamMap(
          reportScopeParams({ scopeMode: 'selected', estateIds: [] }),
        ),
      ),
    ).toEqual({ scopeMode: 'selected', estateIds: [] });
  });
  it('solo hereda una selección explícita única para los informes individuales', () => {
    expect(
      scopeForReport({ scopeMode: 'selected', estateIds: ['e1'] }, true)
        .estateIds,
    ).toEqual(['e1']);
    expect(
      scopeForReport({ scopeMode: 'selected', estateIds: ['e1', 'e2'] }, true)
        .estateIds,
    ).toEqual([]);
    expect(scopeForReport({ scopeMode: 'all', estateIds: [] }, true)).toEqual({
      scopeMode: 'selected',
      estateIds: [],
    });
  });
  it('Informes comparte una sola comunidad y reduce varias (o Todas) a Todas', () => {
    expect(reportScopeFromShared('e1')).toEqual({ scopeMode: 'selected', estateIds: ['e1'] });
    expect(reportScopeFromShared(null)).toEqual({ scopeMode: 'all', estateIds: [] });
    expect(sharedEstateForReport({ scopeMode: 'selected', estateIds: ['e1'] })).toBe('e1');
    expect(sharedEstateForReport({ scopeMode: 'selected', estateIds: ['e1', 'e2'] })).toBeNull();
    expect(sharedEstateForReport({ scopeMode: 'all', estateIds: [] })).toBeNull();
    expect(sharedEstateForReport({ scopeMode: 'selected', estateIds: [] })).toBeUndefined();
  });
});
