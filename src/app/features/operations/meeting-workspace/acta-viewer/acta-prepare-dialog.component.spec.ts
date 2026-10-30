import { setupComponent } from '../../../../core/testing/component-harness';
import type { ActaValidation } from '../../../../core/acta.models';
import { actaValidation } from './acta-fixtures';
import { ActaPrepareDialogComponent, toIso, toTimeInput } from './acta-prepare-dialog.component';

function setup(validation: ActaValidation = actaValidation(), inputs: { busy?: boolean; error?: string } = {}) {
  const h = setupComponent(ActaPrepareDialogComponent);
  h.fixture.componentRef.setInput('validation', validation);
  h.fixture.componentRef.setInput('busy', inputs.busy ?? false);
  h.fixture.componentRef.setInput('error', inputs.error ?? '');
  h.fixture.detectChanges();
  const generate = vi.fn();
  const closed = vi.fn();
  h.component.generate.subscribe(generate);
  h.component.closed.subscribe(closed);
  return Object.assign(h, { generate, closed });
}
type Ctx = ReturnType<typeof setup>;
const dialog = (h: Ctx) => h.fixture.nativeElement as HTMLElement;
const generateButton = (h: Ctx) => Array.from(dialog(h).querySelectorAll('.modal__footer button')).pop() as HTMLButtonElement;
const type = (input: HTMLInputElement, value: string) => {
  input.value = value;
  input.dispatchEvent(new Event('input'));
};

describe('ActaPrepareDialogComponent — datos de la reunión que Domora no puede deducir', () => {
  it('es una pequeña etapa de preparación, no un formulario enorme: interruptor de convocatoria y dos horas', () => {
    const h = setup();
    expect(dialog(h).textContent).toContain('Preparar el acta');
    expect(dialog(h).querySelectorAll('[role="switch"]')).toHaveLength(1);
    expect(dialog(h).querySelectorAll('.time select')).toHaveLength(4);
    expect(dialog(h).querySelectorAll('input[type="time"]')).toHaveLength(0);
    expect((dialog(h).querySelector('.modal') as HTMLElement).className).toBe('modal');
  });

  it('llega rellenado: 1ª convocatoria, su hora como inicio y la hora de «celebrada» como fin', () => {
    const h = setup();
    expect(dialog(h).textContent).toContain('Convocatorias: 1ª');
    expect(h.component.convocation()).toBe('primera');
    expect(h.component.startTime()).toBe(toTimeInput('2026-10-14T17:00:00Z'));
    expect(h.component.endTime()).toBe(toTimeInput('2026-10-14T19:20:00Z'));
    expect(generateButton(h).disabled).toBe(false);
    expect(dialog(h).textContent).toContain('La hora de fin se ha rellenado con la de marcar la junta como celebrada');
  });

  it('las horas son desplegables de Domora (hora y minutos, 24 h) con lo ya rellenado seleccionado', async () => {
    const h = setup();
    await h.fixture.whenStable();
    h.fixture.detectChanges();
    await h.fixture.whenStable();
    const selects = Array.from(dialog(h).querySelectorAll<HTMLSelectElement>('.time select'));
    expect(selects.every((select) => select.classList.contains('dd-select'))).toBe(true);
    expect(selects[0].options).toHaveLength(24);
    expect(selects[1].options).toHaveLength(60);
    const [startHour, startMinute] = h.component.startTime().split(':');
    expect(selects[0].value).toBe(startHour);
    expect(selects[1].value).toBe(startMinute);
  });

  it('cambiar solo la hora o solo los minutos conserva la otra parte', () => {
    const h = setup();
    h.component.startTime.set('11:12');
    h.component.setPart('start', 'hour', '18');
    expect(h.component.startTime()).toBe('18:12');
    h.component.setPart('start', 'minute', '45');
    expect(h.component.startTime()).toBe('18:45');
    h.component.endTime.set('');
    h.component.setPart('end', 'hour', '20');
    expect(h.component.endTime()).toBe('20:00');
  });

  it('el interruptor usa el de ajustes en versión «elegir»: verde en las dos posiciones', () => {
    const h = setup();
    const toggle = dialog(h).querySelector('app-toggle .toggle') as HTMLButtonElement;
    expect(toggle.classList).toContain('toggle--choice');
    expect(toggle.classList).not.toContain('toggle--on');
    toggle.click();
    h.fixture.detectChanges();
    expect(h.component.convocation()).toBe('segunda');
    expect(toggle.classList).toContain('toggle--on');
    const labels = Array.from(dialog(h).querySelectorAll('.toggle__label'));
    expect(labels.map((label) => label.classList.contains('toggle__label--on'))).toEqual([false, true]);
  });

  it('el interruptor va de «Primera convocatoria» a «Segunda convocatoria» y la hora de inicio acompaña', () => {
    const h = setup();
    const labels = Array.from(dialog(h).querySelectorAll('.toggle__label')).map((el) => el.textContent?.trim());
    expect(labels).toEqual(['Primera convocatoria', 'Segunda convocatoria']);
    const toggle = dialog(h).querySelector('[role="switch"]') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    toggle.click();
    h.fixture.detectChanges();
    expect(h.component.convocation()).toBe('segunda');
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(h.component.startTime()).toBe(toTimeInput('2026-10-14T17:30:00Z'));
    (dialog(h).querySelectorAll('.toggle__label')[0] as HTMLButtonElement).click();
    expect(h.component.convocation()).toBe('primera');
    expect(h.component.startTime()).toBe(toTimeInput('2026-10-14T17:00:00Z'));
  });

  it('si la hora de inicio se cambió a mano, cambiar de convocatoria no la pisa', () => {
    const h = setup();
    h.component.startTime.set('19:45');
    h.component.setConvocation('segunda');
    expect(h.component.startTime()).toBe('19:45');
  });

  it('no deja generar si falta alguna de las dos horas', () => {
    const h = setup();
    h.component.endTime.set('');
    h.fixture.detectChanges();
    expect(generateButton(h).disabled).toBe(true);
    h.component.endTime.set('21:05');
    h.component.startTime.set('');
    h.fixture.detectChanges();
    expect(generateButton(h).disabled).toBe(true);
    h.component.startTime.set('19:10');
    h.fixture.detectChanges();
    expect(generateButton(h).disabled).toBe(false);
  });

  it('sin hora de «celebrada», la hora de fin queda vacía y hay que escribirla', () => {
    const h = setup(actaValidation({ reference: { scheduledAt1: '2026-10-14T17:00:00Z', scheduledAt2: '2026-10-14T17:30:00Z', celebratedAt: null } }));
    expect(h.component.endTime()).toBe('');
    expect(generateButton(h).disabled).toBe(true);
    expect(dialog(h).querySelector('.suggestion')).toBeNull();
  });

  it('emite las horas como instantes del día de la reunión y la convocatoria elegida', () => {
    const h = setup();
    h.component.setConvocation('segunda');
    h.component.startTime.set('19:40');
    h.component.endTime.set('21:15');
    h.fixture.detectChanges();
    generateButton(h).click();
    const [payload] = h.generate.mock.calls[0];
    expect(payload.effectiveConvocation).toBe('segunda');
    expect(toTimeInput(payload.actualStartAt)).toBe('19:40');
    expect(toTimeInput(payload.actualEndAt)).toBe('21:15');
    expect(new Date(payload.actualStartAt).toDateString()).toBe(new Date('2026-10-14T17:00:00Z').toDateString());
  });

  it('precarga lo que la gestora ya confirmó', () => {
    const confirmed = { actualStartAt: '2026-10-14T17:10:00.000Z', actualEndAt: '2026-10-14T19:05:00.000Z', effectiveConvocation: 'primera' as const };
    const h = setup(actaValidation({ confirmed, missingFields: [] }));
    expect(h.component.startTime()).toBe(toTimeInput(confirmed.actualStartAt));
    expect(h.component.endTime()).toBe(toTimeInput(confirmed.actualEndAt));
    expect(h.component.convocation()).toBe('primera');
  });

  it('una hora de fin anterior o igual a la de inicio se señala y no deja generar', () => {
    const h = setup();
    h.component.startTime.set('20:00');
    h.component.endTime.set('19:00');
    h.fixture.detectChanges();
    expect(dialog(h).textContent).toContain('La hora de fin debe ser posterior a la de inicio.');
    expect(generateButton(h).disabled).toBe(true);
  });

  it('un error que no es de este formulario (votaciones abiertas, junta sin celebrar) se muestra y bloquea', () => {
    const h = setup(actaValidation({ errors: [{ code: 'VOTES_OPEN', message: 'Hay 1 votación(es) abierta(s): ciérralas antes de preparar el acta.' }] }));
    h.fixture.detectChanges();
    expect(dialog(h).querySelector('[data-testid="blocking"]')!.textContent).toContain('Hay 1 votación(es) abierta(s)');
    expect(generateButton(h).disabled).toBe(true);
  });

  it('muestra los avisos (no bloquean) y el error de la última generación', () => {
    const h = setup(actaValidation({ warnings: [{ code: 'MISSING_QUOTA', message: '2 propiedad(es) no tienen coeficiente.' }] }), { error: 'No se pudo generar el borrador del acta.' });
    expect(dialog(h).querySelector('.warnings')!.textContent).toContain('2 propiedad(es) no tienen coeficiente.');
    expect(dialog(h).textContent).toContain('No se pudo generar el borrador del acta.');
  });

  it('mientras genera, no se puede cerrar ni volver a generar', () => {
    const h = setup(actaValidation(), { busy: true });
    expect(generateButton(h).textContent).toContain('Generando…');
    h.component.close();
    expect(h.closed).not.toHaveBeenCalled();
  });

  it('Cancelar cierra', () => {
    const h = setup();
    h.component.close();
    expect(h.closed).toHaveBeenCalled();
  });

  it('se cuelga del <body> y se retira al destruirse', () => {
    const h = setup();
    const element = dialog(h);
    expect(element.parentElement).toBe(document.body);
    h.fixture.destroy();
    expect(document.body.contains(element)).toBe(false);
  });

  describe('conversión de horas', () => {
    it('toTimeInput / toIso son inversas en la zona horaria del navegador', () => {
      const base = new Date('2026-10-14T17:00:00Z');
      const iso = toIso(base, '19:05')!;
      expect(toTimeInput(iso)).toBe('19:05');
      expect(toIso(base, 'no')).toBeNull();
      expect(toTimeInput(null)).toBe('');
    });
  });
});

// `type` se deja disponible para pruebas que necesiten teclear en un campo.
void type;
