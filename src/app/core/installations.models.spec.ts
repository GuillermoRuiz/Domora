import { INSTALLATION_STATUS, OPERATIONAL_STATUS_OPTIONS, reviewDeadlineLabel } from './installations.models';

describe('reviewDeadlineLabel', () => {
  it.each([
    [null, ''],
    [0, 'hoy'],
    [1, 'en 1 día'],
    [3, 'en 3 días'],
    [60, 'en 60 días'],
    [61, 'en 2 meses'],
    [270, 'en 9 meses'],
    [-1, 'hace 1 día'],
    [-20, 'hace 20 días'],
    [-61, 'hace 2 meses'],
  ])('%s → "%s"', (days, label) => {
    expect(reviewDeadlineLabel(days as number | null)).toBe(label);
  });
});

describe('estados de instalación', () => {
  it('cada estado a mostrar tiene texto y tono', () => {
    expect(Object.keys(INSTALLATION_STATUS).sort()).toEqual(['en_mantenimiento', 'fuera_de_servicio', 'operativa', 'revision_proxima', 'revision_vencida']);
    expect(INSTALLATION_STATUS.revision_vencida).toEqual({ text: 'Revisión vencida', tone: 'danger' });
  });

  it('el gestor solo elige los estados declarables, no los derivados de la revisión', () => {
    expect(OPERATIONAL_STATUS_OPTIONS.map(o => o.value)).toEqual(['operativa', 'en_mantenimiento', 'fuera_de_servicio']);
  });
});
