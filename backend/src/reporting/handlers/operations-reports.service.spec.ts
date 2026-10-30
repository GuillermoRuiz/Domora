import { OperationsReportsService } from './operations-reports.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ReportScope } from '../reporting.types';

describe('Operations report data semantics', () => {
  const scope = {
    estateIds: ['estate'],
    estates: [{ id: 'estate', name: 'Comunidad' }],
  } as ReportScope;
  it('does not infer missing resolution from updatedAt or terminal state', async () => {
    const prisma = {
      issue: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            {
              id: 'i',
              ref: 'I-1',
              title: 'Avería',
              status: 'Resuelta',
              type: 'Otro',
              createdAt: new Date('2026-01-01'),
              resolvedAt: null,
              closedAt: null,
              property: { estateId: 'estate', ref: 'P' },
              timeline: [],
              providerAssignments: [],
            },
          ]),
      },
    };
    const report = await new OperationsReportsService(
      prisma as unknown as PrismaService,
    ).run('issue-resolution', { scopeMode: 'all' }, scope);
    expect(report.sections[0].rows[0]['days']).toBeNull();
    expect(report.warnings?.join(' ')).toMatch(/sin transición/);
  });
});
