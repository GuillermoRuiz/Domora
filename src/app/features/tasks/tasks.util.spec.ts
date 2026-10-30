import { AgendaTask } from '../../core/agenda-tasks.model';
import {
  allDayDateInput,
  allDayIso,
  bucketByDay,
  combineLocal,
  dateKey,
  endAfterStartChange,
  formatTime,
  isUpcoming,
  periodLabel,
  scheduleProblem,
  shiftAnchor,
  startOfWeek,
  tasksOfDay,
  timeRangeLabel,
  viewRange,
} from './tasks.util';

function task(overrides: Partial<AgendaTask> = {}): AgendaTask {
  return {
    id: 't1', occurrenceKey: 't1', recurring: false,
    occurrenceStart: new Date(2026, 9, 14, 9, 0).toISOString(),
    occurrenceEnd: new Date(2026, 9, 14, 10, 0).toISOString(),
    title: 'Llamada', estate: null, assignee: null, type: 'LLAMADA', priority: 'MEDIA',
    status: 'PENDIENTE', overdue: false, allDay: false, timezone: 'Europe/Madrid',
    startAt: new Date(2026, 9, 14, 9, 0).toISOString(), endAt: new Date(2026, 9, 14, 10, 0).toISOString(),
    reminderMinutesBefore: null, recurrence: null, labels: [], checklistDone: 0, checklistTotal: 0,
    commentCount: 0, attachmentCount: 0, linkCount: 0, source: 'manual', createdByUserId: 'u1',
    createdByKind: 'person', issueId: null, kind: null,
    ...overrides,
  };
}

// 14-oct-2026 es miércoles.
const WEDNESDAY = new Date(2026, 9, 14);

describe('tasks.util', () => {
  describe('rangos', () => {
    it('la semana empieza en lunes y dura 7 días', () => {
      const { from, to, days } = viewRange('week', WEDNESDAY);

      expect(dateKey(from)).toBe('2026-10-12');
      expect(dateKey(to)).toBe('2026-10-19');
      expect(days.map(dateKey)).toEqual([
        '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18',
      ]);
    });

    it('un domingo pertenece a la semana que empezó el lunes anterior', () => {
      expect(dateKey(startOfWeek(new Date(2026, 9, 18)))).toBe('2026-10-12');
      expect(dateKey(startOfWeek(new Date(2026, 9, 19)))).toBe('2026-10-19');
    });

    it('el día es un solo día', () => {
      const { days, from, to } = viewRange('day', WEDNESDAY);
      expect(days).toHaveLength(1);
      expect(to.getTime() - from.getTime()).toBe(86_400_000);
    });

    it('el mes se completa con las semanas enteras (lunes a domingo)', () => {
      const { days } = viewRange('month', WEDNESDAY); // octubre 2026: 1 jue … 31 sáb

      expect(dateKey(days[0])).toBe('2026-09-28');
      expect(dateKey(days[days.length - 1])).toBe('2026-11-01');
      expect(days.length % 7).toBe(0);
    });

    it('navegar: ±1 día, ±7 días, ±1 mes (ajustando al fin de mes)', () => {
      expect(dateKey(shiftAnchor('day', WEDNESDAY, 1))).toBe('2026-10-15');
      expect(dateKey(shiftAnchor('week', WEDNESDAY, -1))).toBe('2026-10-07');
      expect(dateKey(shiftAnchor('month', new Date(2026, 0, 31), 1))).toBe('2026-02-28');
    });
  });

  describe('etiqueta del periodo', () => {
    it('semana dentro de un mes', () => {
      expect(periodLabel('week', WEDNESDAY)).toBe('12 – 18 octubre 2026');
    });

    it('semana a caballo entre dos meses y entre dos años', () => {
      expect(periodLabel('week', new Date(2026, 9, 1))).toBe('28 sep – 4 oct 2026');
      expect(periodLabel('week', new Date(2026, 11, 30))).toBe('28 dic 2026 – 3 ene 2027');
    });

    it('día y mes', () => {
      expect(periodLabel('day', WEDNESDAY)).toBe('miércoles 14 octubre 2026');
      expect(periodLabel('month', WEDNESDAY)).toBe('octubre 2026');
    });
  });

  describe('colocación de tareas', () => {
    const days = viewRange('week', WEDNESDAY).days;

    it('un bloque con hora se coloca por minutos desde medianoche', () => {
      const bucket = bucketByDay([task()], days).get('2026-10-14');

      expect(bucket?.timed).toHaveLength(1);
      expect(bucket?.timed[0]).toMatchObject({ startMin: 9 * 60, endMin: 10 * 60, column: 0, columns: 1 });
    });

    it('una tarea sin duración no ocupa bloque: es una nota de su día', () => {
      const bucket = bucketByDay([task({ noDuration: true })], days).get('2026-10-14');

      expect(bucket?.notes).toHaveLength(1);
      expect(bucket?.timed).toHaveLength(0);
      expect(tasksOfDay(bucket)).toHaveLength(1);
      expect(timeRangeLabel(task({ noDuration: true }))).toBe('Sin duración');
    });

    it('una tarea muy corta conserva un alto mínimo legible', () => {
      const short = task({ occurrenceEnd: task().occurrenceStart });
      const segment = bucketByDay([short], days).get('2026-10-14')?.timed[0];

      expect(segment?.visualEndMin).toBe(9 * 60 + 30);
    });

    it('las tareas que se solapan se reparten en columnas; las que no, no', () => {
      const a = task({ occurrenceKey: 'a', occurrenceEnd: new Date(2026, 9, 14, 11, 0).toISOString() });
      const b = task({ occurrenceKey: 'b', occurrenceStart: new Date(2026, 9, 14, 10, 0).toISOString(), occurrenceEnd: new Date(2026, 9, 14, 12, 0).toISOString() });
      const c = task({ occurrenceKey: 'c', occurrenceStart: new Date(2026, 9, 14, 13, 0).toISOString(), occurrenceEnd: new Date(2026, 9, 14, 14, 0).toISOString() });

      const timed = bucketByDay([a, b, c], days).get('2026-10-14')?.timed ?? [];
      const byKey = Object.fromEntries(timed.map((s) => [s.task.occurrenceKey, s]));

      expect(byKey['a']).toMatchObject({ column: 0, columns: 2 });
      expect(byKey['b']).toMatchObject({ column: 1, columns: 2 });
      expect(byKey['c']).toMatchObject({ column: 0, columns: 1 });
    });

    it('una tarea que cruza la medianoche se parte en un tramo por día', () => {
      const night = task({
        occurrenceStart: new Date(2026, 9, 14, 22, 0).toISOString(),
        occurrenceEnd: new Date(2026, 9, 15, 2, 0).toISOString(),
      });
      const buckets = bucketByDay([night], days);

      expect(buckets.get('2026-10-14')?.timed[0]).toMatchObject({ startMin: 22 * 60, endMin: 24 * 60 });
      expect(buckets.get('2026-10-15')?.timed[0]).toMatchObject({ startMin: 0, endMin: 2 * 60 });
    });

    it('una tarea que acaba justo a las 00:00 no aparece en el día siguiente', () => {
      const t = task({
        occurrenceStart: new Date(2026, 9, 14, 22, 0).toISOString(),
        occurrenceEnd: new Date(2026, 9, 15, 0, 0).toISOString(),
      });

      expect(bucketByDay([t], days).get('2026-10-15')?.timed).toHaveLength(0);
    });

    it('las tareas de día completo van a la franja "Todo el día" y se leen en UTC', () => {
      const allDay = task({
        allDay: true,
        occurrenceStart: '2026-10-14T00:00:00.000Z',
        occurrenceEnd: '2026-10-15T00:00:00.000Z',
      });
      const buckets = bucketByDay([allDay], days);

      expect(buckets.get('2026-10-14')?.allDay).toHaveLength(1);
      expect(buckets.get('2026-10-14')?.timed).toHaveLength(0);
      expect(buckets.get('2026-10-13')?.allDay).toHaveLength(0);
      expect(buckets.get('2026-10-15')?.allDay).toHaveLength(0);
    });

    it('un día completo de varios días ocupa cada uno de ellos', () => {
      const multi = task({
        allDay: true,
        occurrenceStart: '2026-10-14T00:00:00.000Z',
        occurrenceEnd: '2026-10-17T00:00:00.000Z',
      });
      const buckets = bucketByDay([multi], days);

      expect(['14', '15', '16'].map((d) => buckets.get(`2026-10-${d}`)?.allDay.length)).toEqual([1, 1, 1]);
      expect(buckets.get('2026-10-17')?.allDay).toHaveLength(0);
    });

    it('tasksOfDay lista primero "todo el día" y luego por hora', () => {
      const early = task({ occurrenceKey: 'early', occurrenceStart: new Date(2026, 9, 14, 8, 0).toISOString(), occurrenceEnd: new Date(2026, 9, 14, 8, 30).toISOString() });
      const late = task({ occurrenceKey: 'late', occurrenceStart: new Date(2026, 9, 14, 17, 0).toISOString(), occurrenceEnd: new Date(2026, 9, 14, 18, 0).toISOString() });
      const all = task({ occurrenceKey: 'all', allDay: true, occurrenceStart: '2026-10-14T00:00:00.000Z', occurrenceEnd: '2026-10-15T00:00:00.000Z' });

      const ordered = tasksOfDay(bucketByDay([late, all, early], days).get('2026-10-14')).map((t) => t.occurrenceKey);

      expect(ordered).toEqual(['all', 'early', 'late']);
    });
  });

  describe('conversión fecha/hora de formularios', () => {
    it('combineLocal interpreta fecha y hora en la zona local', () => {
      const d = combineLocal('2026-10-14', '09:30');
      expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 9, 14, 9, 30]);
    });

    it('los días completos se guardan como medianoche UTC y vuelven igual', () => {
      expect(allDayIso('2026-10-14')).toBe('2026-10-14T00:00:00.000Z');
      expect(allDayIso('2026-10-14', 1)).toBe('2026-10-15T00:00:00.000Z');
      expect(allDayDateInput('2026-10-14T00:00:00.000Z')).toBe('2026-10-14');
    });
  });

  describe('zonas horarias y cambio horario', () => {
    // Zona con las reglas de Europa Central (CET en invierno, CEST en verano): Madrid, París, Berlín…
    const inCentralEurope =
      new Date(2026, 0, 15).getTimezoneOffset() === -60 && new Date(2026, 6, 15).getTimezoneOffset() === -120;

    it('la semana del cambio de hora (25-oct-2026, un día de 25 h) sigue teniendo 7 días consecutivos', () => {
      const { days, from, to } = viewRange('week', new Date(2026, 9, 22));

      expect(days.map(dateKey)).toEqual([
        '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25',
      ]);
      expect(dateKey(from)).toBe('2026-10-19');
      expect(dateKey(to)).toBe('2026-10-26');
    });

    it('una tarea a las 03:00 del día del cambio de hora se coloca por hora de reloj, no por milisegundos', () => {
      const start = new Date(2026, 9, 25, 3, 0);
      const t = task({ occurrenceStart: start.toISOString(), occurrenceEnd: new Date(2026, 9, 25, 4, 0).toISOString() });
      const { days } = viewRange('week', new Date(2026, 9, 22));

      const segment = bucketByDay([t], days).get('2026-10-25')?.timed[0];

      expect(segment?.startMin).toBe(3 * 60);
    });

    it.runIf(inCentralEurope)('09:00 locales viajan como 07:00Z en verano (CEST) y 08:00Z en invierno (CET), y vuelven iguales', () => {
      const summer = combineLocal('2026-10-24', '09:00');
      const winter = combineLocal('2026-10-26', '09:00');

      expect(summer.toISOString()).toBe('2026-10-24T07:00:00.000Z');
      expect(winter.toISOString()).toBe('2026-10-26T08:00:00.000Z');
      expect([new Date(summer.toISOString()).getHours(), new Date(winter.toISOString()).getHours()]).toEqual([9, 9]);
    });

    it('mover una tarea de un día a otro conserva su hora local aunque cambie el desfase UTC (arrastrar en el cambio de hora)', () => {
      const original = new Date(2026, 9, 24, 10, 0); // sábado, antes del cambio
      const target = new Date(2026, 9, 26); // lunes, después
      const moved = new Date(target.getFullYear(), target.getMonth(), target.getDate(), original.getHours(), original.getMinutes());

      expect(formatTime(moved)).toBe('10:00');
      expect(dateKey(moved)).toBe('2026-10-26');
    });

    it('las tareas de día completo viajan como medianoche UTC de su fecha, sin depender de la zona del navegador', () => {
      expect(allDayIso('2026-10-25')).toBe('2026-10-25T00:00:00.000Z');
      expect(allDayIso('2026-10-25', 1)).toBe('2026-10-26T00:00:00.000Z');
      expect(allDayDateInput('2026-10-25T00:00:00.000Z')).toBe('2026-10-25');
      // Un día completo de fecha 25 se coloca en el día 25 aunque su medianoche UTC sea el 24 por la noche en zonas al oeste.
      const t = task({ allDay: true, occurrenceStart: '2026-10-25T00:00:00.000Z', occurrenceEnd: '2026-10-26T00:00:00.000Z' });
      const { days } = viewRange('week', new Date(2026, 9, 22));
      const buckets = bucketByDay([t], days);
      expect(buckets.get('2026-10-25')?.allDay).toHaveLength(1);
      expect(buckets.get('2026-10-24')?.allDay).toHaveLength(0);
    });

    it('el rango pedido al servidor para un día es [medianoche local, medianoche local siguiente) en instantes', () => {
      const { from, to } = viewRange('day', new Date(2026, 9, 25));

      expect(from.getTime()).toBe(new Date(2026, 9, 25).getTime());
      expect(to.getTime()).toBe(new Date(2026, 9, 26).getTime());
    });
  });

});

describe('horario de una tarea (inicio y fin)', () => {
  const base = { date: '2026-10-15', time: '10:00', endDate: '2026-10-15', endTime: '11:30' };

  it('mover el inicio conserva la duración, también al cruzar la medianoche', () => {
    expect(endAfterStartChange(base, { date: '2026-10-16', time: '10:00' }, false)).toEqual({ endDate: '2026-10-16', endTime: '11:30' });
    expect(endAfterStartChange(base, { date: '2026-10-15', time: '23:00' }, false)).toEqual({ endDate: '2026-10-16', endTime: '00:30' });
  });

  it('en un día completo conserva los días que abarca', () => {
    const allDay = { ...base, endDate: '2026-10-17' };
    expect(endAfterStartChange(allDay, { date: '2026-11-01', time: '' }, true).endDate).toBe('2026-11-03');
  });

  it('avisa de un fin anterior al inicio y de lo que dura más de 31 días', () => {
    expect(scheduleProblem(base, false)).toBeNull();
    expect(scheduleProblem({ ...base, endTime: '09:00' }, false)).toContain('anteriores');
    expect(scheduleProblem({ ...base, endDate: '2026-12-01' }, false)).toContain('31 días');
    expect(scheduleProblem({ ...base, endDate: '2026-10-14' }, true)).toContain('anterior');
    expect(scheduleProblem({ ...base, endDate: '2026-10-17' }, true)).toBeNull();
    expect(scheduleProblem({ ...base, endDate: '' }, false)).toContain('fecha');
  });
});

describe('timeRangeLabel con varios días', () => {
  it('una tarea que acaba otro día lo indica; las de día completo cuentan los días', () => {
    const timed = task({ occurrenceStart: new Date(2026, 9, 15, 18, 0).toISOString(), occurrenceEnd: new Date(2026, 9, 17, 9, 0).toISOString() });
    expect(timeRangeLabel(timed)).toBe('18:00 – 17 oct, 09:00');
    const allDayMany = task({ allDay: true, occurrenceStart: '2026-10-15T00:00:00.000Z', occurrenceEnd: '2026-10-18T00:00:00.000Z' });
    expect(timeRangeLabel(allDayMany)).toBe('Todo el día (3 días)');
    expect(timeRangeLabel(task({ allDay: true, occurrenceStart: '2026-10-15T00:00:00.000Z', occurrenceEnd: '2026-10-16T00:00:00.000Z' }))).toBe('Todo el día');
    expect(timeRangeLabel(task())).toBe('09:00 – 10:00');
  });
});

describe('isUpcoming', () => {
  const end = new Date('2026-10-28T00:00:00Z');
  it('is true for an open-issue task that is due after the visible period', () => {
    expect(isUpcoming(task({ source: 'issue', occurrenceStart: '2026-10-30T10:00:00Z' }), end)).toBe(true);
  });
  it('is false inside the period, for manual tasks and for series', () => {
    expect(isUpcoming(task({ source: 'issue', occurrenceStart: '2026-10-27T10:00:00Z' }), end)).toBe(false);
    expect(isUpcoming(task({ source: 'manual', occurrenceStart: '2026-10-30T10:00:00Z' }), end)).toBe(false);
    expect(isUpcoming(task({ source: 'issue', recurring: true, occurrenceStart: '2026-10-30T10:00:00Z' }), end)).toBe(false);
  });
});
