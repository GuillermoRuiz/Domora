import { effectiveConvocation } from './effective-convocation';

const at = (iso: string) => new Date(iso);

describe('effectiveConvocation', () => {
  const meeting = { scheduledAt1: at('2026-10-20T10:00:00Z'), scheduledAt2: at('2026-10-20T10:30:00Z') };

  it('antes de la primera convocatoria vale la primera', () => {
    expect(effectiveConvocation(meeting, at('2026-10-20T09:00:00Z'))).toEqual(meeting.scheduledAt1);
  });

  it('entre la primera y la segunda vale la segunda: la junta sigue vigente', () => {
    expect(effectiveConvocation(meeting, at('2026-10-20T10:10:00Z'))).toEqual(meeting.scheduledAt2);
  });

  it('pasada la segunda ya no hay convocatoria', () => {
    expect(effectiveConvocation(meeting, at('2026-10-20T11:00:00Z'))).toBeNull();
  });
});
