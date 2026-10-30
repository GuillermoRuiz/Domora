import {
  firstStartingFrom,
  isOccurrenceStart,
  isValidTimezone,
  occurrencesBetween,
  type SeriesSpec,
} from './recurrence';

const HOUR = 3_600_000;

function series(overrides: Partial<SeriesSpec> = {}): SeriesSpec {
  return {
    startAt: new Date('2026-10-12T09:00:00Z'),
    endAt: new Date('2026-10-12T10:00:00Z'),
    allDay: false,
    timezone: 'UTC',
    rule: null,
    ...overrides,
  };
}

const iso = (o: { start: Date }) => o.start.toISOString();

describe('recurrence', () => {
  describe('tarea sin repetición', () => {
    it('devuelve la propia tarea si solapa con el rango', () => {
      const result = occurrencesBetween(
        series(),
        new Date('2026-10-12T00:00:00Z'),
        new Date('2026-10-13T00:00:00Z'),
      );
      expect(result.map(iso)).toEqual(['2026-10-12T09:00:00.000Z']);
    });

    it('no devuelve nada si queda fuera del rango', () => {
      expect(
        occurrencesBetween(
          series(),
          new Date('2026-10-13T00:00:00Z'),
          new Date('2026-10-14T00:00:00Z'),
        ),
      ).toEqual([]);
    });

    it('incluye una tarea que empezó antes y sigue en curso al inicio del rango', () => {
      const result = occurrencesBetween(
        series({ endAt: new Date('2026-10-12T12:00:00Z') }),
        new Date('2026-10-12T10:00:00Z'),
        new Date('2026-10-12T11:00:00Z'),
      );
      expect(result).toHaveLength(1);
    });
  });

  describe('frecuencias', () => {
    it('diaria: una ocurrencia por día dentro del rango', () => {
      const result = occurrencesBetween(
        series({ rule: { freq: 'DAILY', interval: 1, until: null } }),
        new Date('2026-10-14T00:00:00Z'),
        new Date('2026-10-17T00:00:00Z'),
      );
      expect(result.map(iso)).toEqual([
        '2026-10-14T09:00:00.000Z',
        '2026-10-15T09:00:00.000Z',
        '2026-10-16T09:00:00.000Z',
      ]);
    });

    it('semanal con intervalo 2: cada dos semanas', () => {
      const result = occurrencesBetween(
        series({ rule: { freq: 'WEEKLY', interval: 2, until: null } }),
        new Date('2026-10-01T00:00:00Z'),
        new Date('2026-11-30T00:00:00Z'),
      );
      expect(result.map(iso)).toEqual([
        '2026-10-12T09:00:00.000Z',
        '2026-10-26T09:00:00.000Z',
        '2026-11-09T09:00:00.000Z',
        '2026-11-23T09:00:00.000Z',
      ]);
    });

    it('mensual el día 31: se ajusta al último día de los meses cortos y recupera el 31', () => {
      const result = occurrencesBetween(
        series({
          startAt: new Date('2026-01-31T09:00:00Z'),
          endAt: new Date('2026-01-31T10:00:00Z'),
          rule: { freq: 'MONTHLY', interval: 1, until: null },
        }),
        new Date('2026-02-01T00:00:00Z'),
        new Date('2026-04-01T00:00:00Z'),
      );
      // Cada ocurrencia se calcula desde el inicio de la serie (no encadenada),
      // así que febrero no arrastra su ajuste a marzo.
      expect(result.map(iso)).toEqual([
        '2026-02-28T09:00:00.000Z',
        '2026-03-31T09:00:00.000Z',
      ]);
    });

    it('trimestral (mensual con intervalo 3)', () => {
      const result = occurrencesBetween(
        series({ rule: { freq: 'MONTHLY', interval: 3, until: null } }),
        new Date('2026-10-01T00:00:00Z'),
        new Date('2027-10-30T00:00:00Z'),
      );
      expect(result.map(iso)).toEqual([
        '2026-10-12T09:00:00.000Z',
        '2027-01-12T09:00:00.000Z',
        '2027-04-12T09:00:00.000Z',
        '2027-07-12T09:00:00.000Z',
        '2027-10-12T09:00:00.000Z',
      ]);
    });

    it('anual: el 29 de febrero cae en el 28 los años no bisiestos', () => {
      const result = occurrencesBetween(
        series({
          startAt: new Date('2028-02-29T09:00:00Z'),
          endAt: new Date('2028-02-29T10:00:00Z'),
          rule: { freq: 'YEARLY', interval: 1, until: null },
        }),
        new Date('2029-01-01T00:00:00Z'),
        new Date('2030-01-01T00:00:00Z'),
      );
      expect(result.map(iso)).toEqual(['2029-02-28T09:00:00.000Z']);
    });
  });

  describe('límites', () => {
    it('until es inclusivo y corta la serie', () => {
      const result = occurrencesBetween(
        series({
          rule: {
            freq: 'DAILY',
            interval: 1,
            until: new Date('2026-10-14T09:00:00Z'),
          },
        }),
        new Date('2026-10-12T00:00:00Z'),
        new Date('2026-10-30T00:00:00Z'),
      );
      expect(result.map(iso)).toEqual([
        '2026-10-12T09:00:00.000Z',
        '2026-10-13T09:00:00.000Z',
        '2026-10-14T09:00:00.000Z',
      ]);
    });

    it('un rango anterior al inicio de la serie no devuelve nada', () => {
      expect(
        occurrencesBetween(
          series({ rule: { freq: 'DAILY', interval: 1, until: null } }),
          new Date('2026-09-01T00:00:00Z'),
          new Date('2026-09-30T00:00:00Z'),
        ),
      ).toEqual([]);
    });

    it('salta directamente al rango lejano sin recorrer años de ocurrencias', () => {
      const result = occurrencesBetween(
        series({
          startAt: new Date('2016-01-04T09:00:00Z'),
          endAt: new Date('2016-01-04T10:00:00Z'),
          rule: { freq: 'DAILY', interval: 1, until: null },
        }),
        new Date('2026-10-14T00:00:00Z'),
        new Date('2026-10-15T00:00:00Z'),
      );
      expect(result.map(iso)).toEqual(['2026-10-14T09:00:00.000Z']);
    });

    it('respeta el tope de ocurrencias', () => {
      const result = occurrencesBetween(
        series({ rule: { freq: 'DAILY', interval: 1, until: null } }),
        new Date('2026-10-12T00:00:00Z'),
        new Date('2030-10-12T00:00:00Z'),
        10,
      );
      expect(result).toHaveLength(10);
    });
  });

  describe('hora local y cambio de hora', () => {
    it('mantiene las 10:00 locales al terminar el horario de verano (Europe/Madrid)', () => {
      // 24-oct-2026 10:00 CEST (UTC+2) = 08:00Z. El 25-oct se retrasa la hora.
      const spec = series({
        startAt: new Date('2026-10-24T08:00:00Z'),
        endAt: new Date('2026-10-24T09:00:00Z'),
        timezone: 'Europe/Madrid',
        rule: { freq: 'DAILY', interval: 1, until: null },
      });
      const result = occurrencesBetween(
        spec,
        new Date('2026-10-24T00:00:00Z'),
        new Date('2026-10-28T00:00:00Z'),
      );
      expect(result.map(iso)).toEqual([
        '2026-10-24T08:00:00.000Z', // 10:00 CEST
        '2026-10-25T09:00:00.000Z', // 10:00 CET
        '2026-10-26T09:00:00.000Z',
        '2026-10-27T09:00:00.000Z',
      ]);
    });

    it('mantiene la duración absoluta de cada ocurrencia', () => {
      const result = occurrencesBetween(
        series({
          startAt: new Date('2026-10-24T08:00:00Z'),
          endAt: new Date('2026-10-24T09:30:00Z'),
          timezone: 'Europe/Madrid',
          rule: { freq: 'DAILY', interval: 1, until: null },
        }),
        new Date('2026-10-25T00:00:00Z'),
        new Date('2026-10-26T00:00:00Z'),
      );
      expect(result[0].end.getTime() - result[0].start.getTime()).toBe(
        1.5 * HOUR,
      );
    });

    it('las tareas de día completo se calculan en UTC (sin desplazamiento)', () => {
      const result = occurrencesBetween(
        series({
          startAt: new Date('2026-10-24T00:00:00Z'),
          endAt: new Date('2026-10-25T00:00:00Z'),
          allDay: true,
          timezone: 'Europe/Madrid',
          rule: { freq: 'DAILY', interval: 1, until: null },
        }),
        new Date('2026-10-25T00:00:00Z'),
        new Date('2026-10-28T00:00:00Z'),
      );
      expect(result.map(iso)).toEqual([
        '2026-10-25T00:00:00.000Z',
        '2026-10-26T00:00:00.000Z',
        '2026-10-27T00:00:00.000Z',
      ]);
    });
  });

  describe('utilidades', () => {
    const daily = series({ rule: { freq: 'DAILY', interval: 1, until: null } });

    it('isOccurrenceStart distingue inicios reales de instantes arbitrarios', () => {
      expect(isOccurrenceStart(daily, new Date('2026-10-20T09:00:00Z'))).toBe(
        true,
      );
      expect(isOccurrenceStart(daily, new Date('2026-10-20T09:30:00Z'))).toBe(
        false,
      );
      expect(isOccurrenceStart(daily, new Date('2026-10-11T09:00:00Z'))).toBe(
        false,
      );
    });

    it('firstStartingFrom devuelve la próxima ocurrencia o null', () => {
      const horizon = new Date('2026-12-31T00:00:00Z');
      expect(
        firstStartingFrom(
          daily,
          new Date('2026-10-20T09:30:00Z'),
          horizon,
        )?.start.toISOString(),
      ).toBe('2026-10-21T09:00:00.000Z');

      const ended = series({
        rule: {
          freq: 'DAILY',
          interval: 1,
          until: new Date('2026-10-13T09:00:00Z'),
        },
      });
      expect(
        firstStartingFrom(ended, new Date('2026-10-20T00:00:00Z'), horizon),
      ).toBeNull();
    });

    it('isValidTimezone acepta zonas IANA y rechaza basura', () => {
      expect(isValidTimezone('Europe/Madrid')).toBe(true);
      expect(isValidTimezone('Atlantis/Nowhere')).toBe(false);
    });
  });
});
