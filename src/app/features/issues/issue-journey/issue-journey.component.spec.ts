import { API, setupComponent, settle } from '../../../core/testing/component-harness';
import { IssueJourneyComponent } from './issue-journey.component';

const done = (key: string, label: string, completedAt = '2026-10-27T09:00:00Z') => ({
  id: null,
  key,
  label,
  status: 'completed',
  custom: false,
  completedAt,
});

const view = (over: object = {}) => ({
  route: 'community_insurance',
  status: 'on_track',
  steps: [
    done('created', 'Incidencia creada'),
    done('claim:aaaa', 'Siniestro SIN-2026-005 abierto'),
    {
      id: null,
      key: 'wait:bbbb',
      label: 'Esperando respuesta de Mapfre',
      status: 'current',
      custom: false,
      startedAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
      dueAt: '2026-10-28T10:00:00Z',
      overdue: true,
      source: { type: 'wait', id: 'w1' },
      action: { type: 'register_response', entityId: 'w1' },
      claim: { id: 'c1', insurerName: 'Mapfre', reference: 'SIN-2026-005', status: 'open' },
    },
    { id: null, key: 'next', label: 'Después: revisar la respuesta', status: 'upcoming', custom: false },
  ],
  ...over,
});

describe('IssueJourneyComponent', () => {
  async function setup(payload: object = view()) {
    const h = setupComponent(IssueJourneyComponent);
    h.fixture.componentRef.setInput('issueId', 'i1');
    h.fixture.detectChanges();
    await settle();
    h.http.expectOne(`${API}/issues/i1/journey`).flush(payload);
    await settle();
    h.fixture.detectChanges();
    return h;
  }
  const el = (h: Awaited<ReturnType<typeof setup>>) => h.fixture.nativeElement as HTMLElement;

  it('normaliza el recorrido del seguro con los tres hitos base y nunca usa el indicio «Después» como cierre', async () => {
    const h = await setup();
    const labels = [...el(h).querySelectorAll('[data-testid="journey-step"], [data-testid="journey-next"]')]
      .map((step) => step.textContent?.trim());
    expect(labels).toEqual(expect.arrayContaining([
      expect.stringContaining('Incidencia creada'),
      expect.stringContaining('Contactar con el seguro de la comunidad'),
      expect.stringContaining('Incidencia cerrada'),
    ]));
    expect(labels.join(' ')).not.toContain('Después: revisar la respuesta');
    expect(el(h).querySelectorAll('[data-testid="journey-now"]')).toHaveLength(1);
    expect(el(h).querySelector('[data-testid="journey-current"]')?.textContent).toContain('Decide cómo sigue la incidencia');
  });

  it('si el recorrido no carga no deja el panel vacío: avisa y deja reintentar', async () => {
    const h = setupComponent(IssueJourneyComponent);
    h.fixture.componentRef.setInput('issueId', 'i1');
    h.fixture.detectChanges();
    await settle();
    h.http.expectOne(`${API}/issues/i1/journey`).flush({ message: 'boom' }, { status: 500, statusText: 'Server Error' });
    await settle();
    h.fixture.detectChanges();
    expect(el(h).querySelector('[data-testid="journey-error"]')).not.toBeNull();

    (el(h).querySelector('[data-testid="journey-retry"]') as HTMLButtonElement).click();
    await settle();
    h.http.expectOne(`${API}/issues/i1/journey`).flush(view());
    await settle();
    h.fixture.detectChanges();
    expect(el(h).querySelector('[data-testid="journey-error"]')).toBeNull();
    expect(el(h).querySelector('[data-testid="journey-now"]')).not.toBeNull();
  });

  it('una respuesta con el formato antiguo (sin steps) se trata como fallo', async () => {
    const h = await setup({ route: 'community_insurance', milestones: [] });
    expect(el(h).querySelector('[data-testid="journey-error"]')).not.toBeNull();
  });

  it('el bloque Ahora solo muestra el título fijo y las acciones disponibles', async () => {
    const h = await setup();
    const text = el(h).querySelector('[data-testid="journey-now"]')?.textContent ?? '';
    expect(text).toContain('Ahora');
    expect(text).toContain('Decide cómo sigue la incidencia');
    expect(text).not.toContain('Esperando respuesta de Mapfre');
    expect(text).not.toContain('Seguimiento vencido');
    expect(text).not.toContain('SIN-2026-005');
    expect(el(h).querySelector('.now--alert')).not.toBeNull();
  });

  it('muestra fecha y hora en los hitos y ofrece Completar siempre', async () => {
    const h = await setup();
    expect(el(h).querySelector('.step__meta')?.textContent).toMatch(/27 oct.*10:00/);
    expect(el(h).querySelector('[data-testid="journey-schedule-task"]')?.textContent?.trim()).toBe('Añadir tarea');
    expect(el(h).querySelector('[data-testid="journey-complete"]')?.textContent).toContain('Completar');
  });

  it('coloca Ahora justo debajo del primer hito pendiente', async () => {
    const h = await setup();
    const active = el(h).querySelector('[data-testid="journey-next"][data-active="true"]') as HTMLElement;
    const now = el(h).querySelector('[data-testid="journey-now"]') as HTMLElement;
    expect(active.textContent).toContain('Contactar con el seguro de la comunidad');
    expect(active.compareDocumentPosition(now) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(now.parentElement?.previousElementSibling).toBe(active);
  });

  it('mantiene Incidencia cerrada como último hito aunque se renombre', async () => {
    const h = await setup({
      ...view(),
      steps: [
        done('created', 'Incidencia creada'),
        { id: 'm1', key: 'custom:m1', label: 'Comprobar reparación', status: 'upcoming', custom: true, position: 10 },
        { id: null, key: 'resolved', label: 'Cierre editado', status: 'upcoming', custom: false, milestone: true, position: 0 },
        { id: null, key: 'define_next_step', label: 'Definir siguiente paso', status: 'current', custom: false },
      ],
    });
    const labels = [...el(h).querySelectorAll('[data-testid="journey-next"]')].map((item) => item.textContent?.trim());
    expect(labels.at(-1)).toContain('Cierre editado');
  });

  it('personalizar permite editar y arrastrar hitos futuros, y asociarlos a un estado', async () => {
    const payload = view();
    const h = await setup({
      ...payload,
      steps: [
        done('created', 'Incidencia creada'),
        { id: 'm1', key: 'custom:m1', label: 'Pedir presupuesto', status: 'upcoming', custom: true, position: 10 },
        { id: 'm2', key: 'custom:m2', label: 'Aprobar presupuesto', status: 'upcoming', custom: true, position: 20 },
      ],
    });
    (el(h).querySelector('.journey__edit') as HTMLButtonElement).click();
    h.fixture.detectChanges();

    expect(el(h).querySelectorAll('[data-testid="journey-next"] .next__dot').length).toBeGreaterThanOrEqual(2);
    expect(el(h).querySelector('[data-testid="journey-next"][data-custom="true"][draggable="true"]')).toBeNull();
    expect(el(h).querySelector('[data-testid="journey-next"][data-custom="true"] [data-testid="drag-handle"]')).not.toBeNull();
    expect(el(h).querySelector('[aria-label="Estado asociado"]')).not.toBeNull();
    expect(el(h).querySelector('[data-testid="journey-next"] [aria-label="Renombrar"]')).not.toBeNull();
    const custom = el(h).querySelector('[data-testid="journey-next"][data-custom="true"]') as HTMLElement;
    const titleRow = custom.querySelector('.next__title-row') as HTMLElement;
    const handle = titleRow.querySelector('[data-testid="drag-handle"]') as HTMLElement;
    const title = titleRow.querySelector('.next__label') as HTMLElement;
    const actions = custom.querySelector('.step__actions') as HTMLElement;
    expect(handle.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(actions.parentElement).toBe(custom.querySelector('.next__content'));
    expect(actions.previousElementSibling).toBe(titleRow);

    const future = h.component.upcoming();
    const dragged = future.find((step) => step.id === 'm2')!;
    const handleForDragged = el(h).querySelector(`[data-handle-for="${h.component.ref(dragged)}"]`) as HTMLButtonElement;
    expect(handleForDragged).not.toBeNull();
    const pointerDown = new MouseEvent('pointerdown', { button: 0, cancelable: true }) as unknown as PointerEvent;
    h.component.startDrag(pointerDown, dragged);
    h.fixture.detectChanges();
    expect(el(h).querySelector('[data-testid="journey-next"].next__item--dragging')?.textContent).toContain('Aprobar presupuesto');
    expect(el(h).querySelector('[aria-live="polite"]')?.textContent).toContain('Moviendo Aprobar presupuesto');
    h.component.dragEnd();
    h.fixture.detectChanges();
    expect(el(h).querySelector('.next__item--dragging')).toBeNull();

    h.component.onHandleKeydown(new KeyboardEvent('keydown', { key: 'ArrowUp', cancelable: true }), h.component.ref(dragged));
    const reorder = h.http.expectOne(`${API}/issues/i1/journey/milestones/m2`);
    expect(reorder.request.body).toEqual({ position: 5 });
    reorder.flush(payload);
  });

  it('personalizar permite asociar un estado a los hitos fijos', async () => {
    const h = await setup();
    (el(h).querySelector('.journey__edit') as HTMLButtonElement).click();
    h.fixture.detectChanges();

    const fixedMilestones = [...el(h).querySelectorAll<HTMLElement>('[data-testid="journey-step"], [data-testid="journey-next"]')]
      .filter((item) => item.dataset['custom'] === 'false');
    expect(fixedMilestones).toHaveLength(3);
    expect(fixedMilestones.every((item) => item.querySelector('[aria-label="Estado asociado"]'))).toBe(true);

    const contact = fixedMilestones.find((item) => item.textContent?.includes('Contactar con el seguro'))!;
    const status = contact.querySelector('[aria-label="Estado asociado"]') as HTMLSelectElement;
    status.value = 'PendienteProveedor';
    status.dispatchEvent(new Event('change'));

    const req = h.http.expectOne(`${API}/issues/i1/journey/milestones/community_insurance%3Acontact`);
    expect(req.request.body).toEqual({ linkedStatus: 'PendienteProveedor' });
    req.flush({
      ...view(),
      steps: [
        done('created', 'Incidencia creada'),
        { id: null, key: 'community_insurance:contact', label: 'Contactar con el seguro de la comunidad', status: 'upcoming', custom: false, milestone: true, linkedStatus: 'PendienteProveedor' },
      ],
    });
    await settle();
    h.fixture.detectChanges();
    expect((el(h).querySelector('[data-testid="journey-next"] [aria-label="Estado asociado"]') as HTMLSelectElement).value)
      .toBe('PendienteProveedor');
  });

  it('Completar marca el hito como hecho sin abrir ningún modal', async () => {
    const h = await setup();
    const emitted: unknown[] = [];
    h.component.act.subscribe((e) => emitted.push(e));
    h.component.decide.subscribe((e) => emitted.push(e));
    expect(el(h).querySelectorAll('.now__actions button')).toHaveLength(2);
    (el(h).querySelector('[data-testid="journey-complete"]') as HTMLButtonElement).click();
    const req = h.http.expectOne((r) => r.method === 'PATCH' && r.url.startsWith(`${API}/issues/i1/journey/milestones/`));
    expect(req.request.body).toEqual({ done: true });
    req.flush(view());
    expect(emitted).toEqual([]);
  });

  it('sin siguiente paso no se oculta: avisa de que falta y deja elegir cómo sigue', async () => {
    const h = await setup({
      route: 'community_insurance',
      status: 'needs_attention',
      steps: [
        done('created', 'Incidencia creada'),
        { id: null, key: 'define_next_step', label: 'Definir siguiente paso', status: 'current', custom: false, action: { type: 'register_activity' } },
      ],
    });
    expect(el(h).querySelector('.now__kicker')?.textContent).toContain('Ahora');
    const chosen: string[] = [];
    h.component.decide.subscribe((k: string) => chosen.push(k));
    expect(el(h).querySelectorAll('.now__actions button')).toHaveLength(2);
    (el(h).querySelector('[data-testid="journey-schedule-task"]') as HTMLButtonElement).click();
    expect(chosen).toEqual(['task']);
    expect(el(h).querySelector('.now--alert')).not.toBeNull();
  });

  it('con una tarea pendiente, el botón pasa a Ver tarea y emite la acción de la tarea', async () => {
    const h = setupComponent(IssueJourneyComponent);
    h.fixture.componentRef.setInput('issueId', 'i1');
    h.fixture.componentRef.setInput('reviewTaskId', 't1');
    h.fixture.detectChanges();
    await settle();
    h.http.expectOne(`${API}/issues/i1/journey`).flush({
      route: 'community_insurance',
      status: 'on_track',
      steps: [
        done('created', 'Incidencia creada'),
        { id: null, key: 'task:t1', label: 'Llamar al seguro de la comunidad', status: 'current', custom: false, source: { type: 'task', id: 't1' }, action: { type: 'open_task', entityId: 't1' } },
      ],
    });
    await settle();
    h.fixture.detectChanges();
    const root = h.fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="journey-current"]')?.textContent).toContain('Decide cómo sigue la incidencia');
    expect(root.querySelector('[data-testid="journey-suggested"]')).toBeNull();
    const emitted: unknown[] = [];
    h.component.act.subscribe((event) => emitted.push(event));
    const view = root.querySelector('[data-testid="journey-schedule-task"]') as HTMLButtonElement;
    expect(view.textContent).toContain('Ver tarea');
    view.click();
    expect(emitted).toEqual([{ type: 'open_task', entityId: 't1' }]);
  });

  it('en el último hito, Añadir tarea abre el cierre de la incidencia', async () => {
    const h = await setup({
      route: 'community_insurance',
      status: 'on_track',
      steps: [
        done('created', 'Incidencia creada'),
        done('community_insurance:contact', 'Contactar con el seguro de la comunidad'),
        { id: null, key: 'define_next_step', label: 'Definir siguiente paso', status: 'current', custom: false },
      ],
    });
    const emitted: unknown[] = [];
    h.component.act.subscribe((event) => emitted.push(event));
    const close = el(h).querySelector('[data-testid="journey-schedule-task"]') as HTMLButtonElement;
    expect(el(h).querySelector('[data-testid="journey-next"][data-active="true"]')?.textContent).toContain('Incidencia cerrada');
    close.click();
    expect(emitted).toEqual([{ type: 'resolve_issue' }]);
  });

  it('muestra los últimos pasos y deja ver los anteriores', async () => {
    const steps = Array.from({ length: 6 }, (_, i) => done(`e${i}`, `Paso ${i}`));
    const h = await setup({ route: null, status: 'resolved', steps });
    expect(el(h).querySelectorAll('[data-testid="journey-step"]')).toHaveLength(4);
    (el(h).querySelector('[data-testid="journey-more"]') as HTMLButtonElement).click();
    h.fixture.detectChanges();
    expect(el(h).querySelectorAll('[data-testid="journey-step"]')).toHaveLength(6);
    expect(el(h).querySelector('[data-testid="journey-now"]')).toBeNull();
  });

  it('personalizar permite añadir un hito propio y pinta lo que devuelve el servidor', async () => {
    const h = await setup();
    (el(h).querySelector('.journey__edit') as HTMLButtonElement).click();
    h.fixture.detectChanges();
    expect(el(h).querySelector('.journey__edit')?.textContent).toContain('Terminar');
    const input = el(h).querySelector('.add__input') as HTMLInputElement;
    input.value = 'Hablar con el presidente';
    (el(h).querySelector('.add') as HTMLFormElement).dispatchEvent(new Event('submit'));
    const req = h.http.expectOne(`${API}/issues/i1/journey/milestones`);
    expect(req.request.body).toEqual({ label: 'Hablar con el presidente', afterKey: 'community_insurance:contact' });
    const base = view();
    req.flush({
      ...base,
      steps: [...base.steps, { id: 'm1', key: 'custom:m1', label: 'Hablar con el presidente', status: 'upcoming', custom: true }],
    });
    await settle();
    h.fixture.detectChanges();
    const milestones = [...el(h).querySelectorAll('[data-testid="journey-step"], [data-testid="journey-next"]')]
      .map((step) => step.textContent ?? '');
    expect(milestones.findIndex((label) => label.includes('Hablar con el presidente')))
      .toBeLessThan(milestones.findIndex((label) => label.includes('Incidencia cerrada')));
  });

  it('un hito del sistema solo se renombra o se oculta: no ofrece marcarlo como hecho', async () => {
    const h = await setup();
    (el(h).querySelector('.journey__edit') as HTMLButtonElement).click();
    h.fixture.detectChanges();
    const labels = [...el(h).querySelectorAll('[data-testid="journey-step"] .icon-btn')].map((b) => b.getAttribute('aria-label'));
    expect(labels).not.toContain('Marcar como hecho');
    expect(labels).toContain('Renombrar');
  });
});
