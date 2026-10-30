import { validateReportInput } from './report-validation';
import { findReport, REPORT_CATALOG } from './definitions/report-catalog';
import { plainToInstance } from 'class-transformer';
import { ReportQueryDto } from './dto/report-query.dto';

describe('report contract', () => {
  it('keeps all 47 functional definitions and hides unsupported rules', () => {
    expect(REPORT_CATALOG.filter((r) => r.status === 'available')).toHaveLength(
      47,
    );
    expect(new Set(REPORT_CATALOG.map((r) => r.key)).size).toBe(
      REPORT_CATALOG.length,
    );
    expect(findReport('sla-breaches')).toBeUndefined();
    expect(findReport('individual-reserve-balance')).toBeUndefined();
  });
  it('rejects invalid calendar dates, inverted ranges and unknown filters', () => {
    const definition = findReport('income-expenses')!;
    expect(() =>
      validateReportInput(
        definition,
        { scopeMode: 'all', from: '2026-02-30', to: '2026-03-01' },
        1,
      ),
    ).toThrow();
    expect(() =>
      validateReportInput(
        definition,
        { scopeMode: 'all', from: '2026-04-01', to: '2026-03-01' },
        1,
      ),
    ).toThrow();
    expect(() =>
      validateReportInput(
        definition,
        {
          scopeMode: 'all',
          from: '2026-01-01',
          to: '2026-03-01',
          filters: { supplierId: 'id' },
        },
        1,
      ),
    ).toThrow();
  });
  it('enforces single-community and explicit comparison periods', () => {
    expect(() =>
      validateReportInput(
        findReport('trial-balance')!,
        { scopeMode: 'all', fiscalYear: 2026 },
        2,
      ),
    ).toThrow();
    expect(() =>
      validateReportInput(
        findReport('period-comparison')!,
        { scopeMode: 'all', from: '2026-01-01', to: '2026-01-31' },
        1,
      ),
    ).toThrow();
  });
  it('accepts empty transformed optional filters and rejects explicit unsupported ones', () => {
    const input = plainToInstance(ReportQueryDto, {
      scopeMode: 'all',
      filters: {},
    });
    expect(() =>
      validateReportInput(findReport('communities')!, input, 1),
    ).not.toThrow();
    expect(() =>
      validateReportInput(
        findReport('communities')!,
        { ...input, filters: { accountCode: '430' } },
        1,
      ),
    ).toThrow();
  });
  it('rejects future composite cutoffs even when supplied as range end', () => {
    expect(() =>
      validateReportInput(
        findReport('meeting-finance')!,
        { scopeMode: 'selected', from: '2099-01-01', to: '2099-01-31' },
        1,
      ),
    ).toThrow();
    expect(() =>
      validateReportInput(
        findReport('monthly-executive')!,
        { scopeMode: 'selected', from: '2099-01-01', to: '2099-01-31' },
        1,
      ),
    ).toThrow();
  });
  it('does not assume a natural year for a comparison', () => {
    expect(() =>
      validateReportInput(
        findReport('period-comparison')!,
        {
          scopeMode: 'all',
          from: '2025-07-01',
          to: '2026-06-30',
          compareFrom: '2024-07-01',
          compareTo: '2025-06-30',
        },
        2,
      ),
    ).not.toThrow();
  });
});
