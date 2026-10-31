import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AgendaTaskKindRegistry } from '../../agenda-tasks/agenda-task-kind-registry.service';
import {
  ISSUE_TASK_KINDS,
  approveQuote,
  chaseProvider,
  confirmVisitOutcome,
  informRequester,
  reviewIssue,
} from './issue-task-definitions';

/**
 * Cada tipo de tarea humana tiene tres esquemas explícitos (payload, resolución
 * y resultRef). Aquí se comprueba que aceptan exactamente lo que deben y
 * rechazan lo demás: sin campos de más, sin tipos distintos, sin JSON libre.
 */
const id = () => randomUUID();

function registryWithAll(): AgendaTaskKindRegistry {
  const registry = new AgendaTaskKindRegistry();
  for (const def of [
    confirmVisitOutcome,
    chaseProvider,
    reviewIssue,
    approveQuote,
    informRequester,
  ]) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    registry.register(def as never);
  }
  return registry;
}

interface Case {
  kind: (typeof ISSUE_TASK_KINDS)[number];
  payload: object;
  resolution: object;
  resultRef: object;
}
const supplier = id();
const wait = id();
const canonical = id();

const CASES: Case[] = [
  {
    kind: 'confirm_visit_outcome',
    payload: { visitId: id() },
    resolution: { decision: 'completed', notes: 'Todo bien' },
    resultRef: { decision: 'completed', visitId: id() },
  },
  {
    kind: 'chase_provider',
    payload: { waitId: wait, supplierId: supplier },
    resolution: {
      decision: 'wait_more',
      extendHours: 24,
      note: 'Le llamo el lunes',
    },
    resultRef: {
      decision: 'wait_more',
      waitId: wait,
      nextDueAt: '2026-10-25T10:00:00.000Z',
    },
  },
  {
    kind: 'review_issue',
    payload: {
      reason: 'manual_review',
    },
    resolution: { decision: 'done' },
    resultRef: { decision: 'done' },
  },
  {
    kind: 'approve_quote',
    payload: {
      supplierId: supplier,
      amountCents: 78000,
      currency: 'EUR',
      description: 'Sustitución del cuadro',
    },
    resolution: { decision: 'approve' },
    resultRef: { decision: 'approve', amountCents: 78000 },
  },
  {
    kind: 'inform_requester',
    payload: { template: 'visit_scheduled', when: '2026-10-29T08:00:00.000Z' },
    resolution: { decision: 'send' },
    resultRef: { decision: 'send', sent: true },
  },
];

describe('esquemas de las tareas humanas', () => {
  const registry = registryWithAll();

  it('hay un caso por cada tipo del catálogo', () => {
    expect(CASES.map((c) => c.kind).sort()).toEqual(
      [...ISSUE_TASK_KINDS].sort(),
    );
  });

  describe.each(CASES)('$kind', (c) => {
    it('acepta su payload, su resolución y su resultRef válidos', () => {
      expect(registry.validatePayload(c.kind, c.payload)).toMatchObject(
        c.payload,
      );
      expect(registry.validateResolution(c.kind, c.resolution)).toMatchObject(
        c.resolution,
      );
      expect(registry.validateResultRef(c.kind, c.resultRef)).toMatchObject(
        c.resultRef,
      );
    });

    it('rechaza campos que no están en el esquema (no hay JSON libre)', () => {
      expect(() =>
        registry.validatePayload(c.kind, { ...c.payload, extra: 1 }),
      ).toThrow(BadRequestException);
      expect(() =>
        registry.validateResolution(c.kind, { ...c.resolution, extra: 1 }),
      ).toThrow(BadRequestException);
      expect(() =>
        registry.validateResultRef(c.kind, { ...c.resultRef, extra: 1 }),
      ).toThrow(BadRequestException);
    });

    it('rechaza lo que no es un objeto', () => {
      for (const bad of [null, 'x', 3, [], undefined]) {
        expect(() => registry.validatePayload(c.kind, bad)).toThrow(
          BadRequestException,
        );
        expect(() => registry.validateResolution(c.kind, bad)).toThrow(
          BadRequestException,
        );
      }
    });

    it('rechaza un payload vacío (todos los tipos llevan algo obligatorio) salvo los que no', () => {
      const required = Object.keys(c.payload).length > 0;
      expect(required).toBe(true);
      expect(() => registry.validatePayload(c.kind, {})).toThrow(
        BadRequestException,
      );
    });
  });

  it('un id que no es UUID se rechaza', () => {
    expect(() =>
      registry.validatePayload('approve_quote', {
        supplierId: 'no-uuid',
        amountCents: 100,
        currency: 'EUR',
      }),
    ).toThrow(/supplierId/);
  });

  it('las decisiones están acotadas: una distinta se rechaza', () => {
    expect(() =>
      registry.validateResolution('confirm_visit_outcome', {
        decision: 'maybe',
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      registry.validateResolution('chase_provider', {
        decision: 'wait_more',
        extendHours: 0,
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      registry.validateResolution('chase_provider', {
        decision: 'wait_more',
        extendHours: 721,
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      registry.validateResolution('chase_provider', {
        decision: 'wait_more',
        extendHours: 1.5,
      }),
    ).toThrow(BadRequestException);
  });

  it('un presupuesto exige importe entero en céntimos, no negativo y en euros', () => {
    const base = { supplierId: supplier, currency: 'EUR' };
    expect(() =>
      registry.validatePayload('approve_quote', { ...base, amountCents: -1 }),
    ).toThrow(BadRequestException);
    expect(() =>
      registry.validatePayload('approve_quote', {
        ...base,
        amountCents: 780.5,
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      registry.validatePayload('approve_quote', {
        ...base,
        amountCents: '780',
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      registry.validatePayload('approve_quote', {
        ...base,
        amountCents: 100,
        currency: 'USD',
      }),
    ).toThrow(BadRequestException);
  });

  it('review_issue solo admite los motivos conocidos', () => {
    expect(() =>
      registry.validatePayload('review_issue', { reason: 'porque_si' }),
    ).toThrow(BadRequestException);
  });

  it('un tipo desconocido no se puede validar ni abrir', () => {
    expect(() => registry.validatePayload('inventado', {})).toThrow(
      /desconocido/,
    );
  });

  it('un tipo no se registra dos veces', () => {
    expect(() => registry.register(approveQuote as never)).toThrow(/duplicado/);
  });
});

describe('textos de las tareas', () => {
  const issue = {
    id: id(),
    ref: '#INC-2026-042',
    title: 'Ascensor averiado',
    priority: 'Normal' as const,
    estateId: id(),
  };

  it('el título de toda tarea es la incidencia («#INC · título») y qué hay que hacer va en la primera línea de la descripción', async () => {
    const db = {
      supplier: {
        findUnique: jest.fn().mockResolvedValue({ name: 'Ascensores Levante' }),
      },
    };
    const built = await approveQuote.build({
      db: db as never,
      issue,
      payload: {
        supplierId: supplier,
        amountCents: 78000,
        currency: 'EUR',
      },
    });
    expect(built.title).toBe('#INC-2026-042 · Ascensor averiado');
    expect(built.description?.split('\n')[0]).toBe(
      'Aprobar presupuesto de 780 €',
    );
    expect(built.description).toContain('Ascensores Levante');
  });

  it('un presupuesto con céntimos los conserva', async () => {
    const db = { supplier: { findUnique: jest.fn().mockResolvedValue(null) } };
    const built = await approveQuote.build({
      db: db as never,
      issue,
      payload: {
        supplierId: supplier,
        amountCents: 78050,
        currency: 'EUR',
      },
    });
    expect(built.description).toContain('780,50 €');
  });
});
