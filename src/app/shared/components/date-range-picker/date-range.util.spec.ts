import { addDays, addMonths, buildMonthGrid, formatRange, fromIsoDate, orderRange, presetRanges, rangeBounds, toIsoDate } from './date-range.util';

describe('date-range.util', () => {
  it('convierte fechas locales de ida y vuelta y rechaza las inválidas', () => {
    expect(toIsoDate(new Date(2026, 9, 5))).toBe('2026-10-05');
    expect(fromIsoDate('2026-10-05')?.getDate()).toBe(5);
    expect(fromIsoDate('2026-02-31')).toBeNull();
    expect(fromIsoDate('basura')).toBeNull();
  });

  it('suma días y meses sin desbordar el fin de mes', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
  });

  it('ordena los extremos del rango', () => {
    expect(orderRange('2026-10-20', '2026-10-10')).toEqual({ from: '2026-10-10', to: '2026-10-20' });
  });

  it('la cuadrícula tiene 6 semanas que empiezan en lunes y cubren todo el mes', () => {
    const weeks = buildMonthGrid('2026-10-18');
    expect(weeks).toHaveLength(6);
    expect(weeks.every(week => week.length === 7)).toBe(true);
    expect(weeks[0][0].iso).toBe('2026-09-28');
    expect(fromIsoDate(weeks[0][0].iso)?.getDay()).toBe(1);
    expect(weeks.flat().filter(day => day.inMonth)).toHaveLength(31);
  });

  it('el rango abarca desde el inicio del primer día hasta el último instante del último', () => {
    const bounds = rangeBounds({ from: '2026-10-16', to: '2026-10-17' });
    expect(new Date(bounds!.start).getHours()).toBe(0);
    expect(new Date(bounds!.end).getDate()).toBe(17);
    expect(new Date(bounds!.end).getHours()).toBe(23);
    expect(rangeBounds({ from: 'x', to: '2026-10-17' })).toBeNull();
  });

  it('da formato a rangos de un día, del mismo año y de años distintos', () => {
    expect(formatRange({ from: '2026-10-17', to: '2026-10-17' })).toContain('2026');
    expect(formatRange({ from: '2026-10-10', to: '2026-10-17' })).toMatch(/^10 oct\.? – 17 oct\.? 2026$/);
    expect(formatRange({ from: '2025-12-30', to: '2026-01-02' })).toContain('2025');
  });

  it('los atajos terminan hoy y cubren 1, 7 y 30 días', () => {
    const [today, week, month] = presetRanges(new Date(2026, 9, 17)).map(p => p.range);
    expect(today).toEqual({ from: '2026-10-17', to: '2026-10-17' });
    expect(week).toEqual({ from: '2026-10-11', to: '2026-10-17' });
    expect(month).toEqual({ from: '2026-09-18', to: '2026-10-17' });
  });
});
