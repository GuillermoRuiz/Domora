import { API, setupComponent, settle } from '../../../core/testing/component-harness';
import type { AgendaTaskDetail } from '../../../core/agenda-tasks.model';
import { ReviewNextStepPanelComponent } from './review-next-step-panel.component';

const task = { id: 't1', kind: 'review_issue', issueId: 'i1', status: 'PENDIENTE', estate: { id: 'e1', name: 'Finca' } } as AgendaTaskDetail;
const SUPPLIERS = [
  { id: 's1', name: 'Ascensores Levante', category: 'Ascensores' },
  { id: 's2', name: 'Mapfre', category: 'Seguros' },
];

describe('ReviewNextStepPanelComponent', () => {
  async function setup(assigned: object | null = null) {
    const h = setupComponent(ReviewNextStepPanelComponent);
    h.fixture.componentRef.setInput('task', task);
    h.fixture.detectChanges();
    h.http.expectOne(`${API}/agenda/assignees`).flush([{ id: 'u1', fullName: 'Isabel' }]);
    h.http.expectOne(`${API}/estates/e1/suppliers`).flush(SUPPLIERS);
    h.http.expectOne(`${API}/issues/i1/provider`).flush(assigned);
    await settle();
    h.fixture.detectChanges();
    return h;
  }
  const el = (h: Awaited<ReturnType<typeof setup>>) => h.fixture.nativeElement as HTMLElement;
  const KEYS = ['task', 'wait', 'visit', 'resolved', 'route', 'exists'] as const;
  const pick = (h: Awaited<ReturnType<typeof setup>>, index: number) => {
    h.component.choice.set(KEYS[index]);
    h.fixture.detectChanges();
  };

  it('no se puede cerrar sin elegir cómo sigue la incidencia', async () => {
    const h = await setup();
    expect((el(h).querySelector('[data-testid="review-submit"]') as HTMLButtonElement).disabled).toBe(true);
    await h.component.submit();
    expect(h.component.problem()).toBe('Elige cómo sigue la incidencia.');
  });

  it('«Tengo que hacer algo» envía tarea con fecha, prioridad y responsable', async () => {
    const h = await setup();
    const said: string[] = [];
    h.component.decided.subscribe((m: string) => said.push(m));
    pick(h, 0);
    h.component.note.set('Llamar al presidente');
    h.component.priority.set('ALTA');
    h.component.assigneeId.set('u1');
    const done = h.component.submit();
    const req = h.http.expectOne(`${API}/agenda/tasks/t1/resolution`);
    expect(req.request.body.result).toMatchObject({ decision: 'schedule_follow_up', note: 'Llamar al presidente', priority: 'ALTA', assigneeUserId: 'u1' });
    req.flush({ ...task, status: 'COMPLETADA' });
    await done;
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/^Tarea creada: «Llamar al presidente» para el /);
  });

  it('cada opción pide lo suyo y lo traduce a su decisión', async () => {
    const h = await setup();
    const body = (index: number, fill: () => void) => {
      pick(h, index);
      fill();
      return h.component.built().body;
    };
    expect(body(1, () => h.component.partyLabel.set('Mapfre'))).toMatchObject({ decision: 'start_wait', party: 'provider', partyLabel: 'Mapfre', dueInHours: 72 });
    expect(body(2, () => { h.component.visitor.set('Peritos SL'); })).toMatchObject({ decision: 'schedule_visit', visitorLabel: 'Peritos SL' });
    expect(body(3, () => undefined)).toEqual({ decision: 'mark_resolved' });
    expect(body(4, () => h.component.route.set('community_provider'))).toEqual({ decision: 'choose_route', route: 'community_provider' });
    expect(body(5, () => undefined)).toEqual({ decision: 'next_step_exists' });
  });

  it('esperar a un proveedor o aseguradora permite elegir una entidad del directorio (y el nombre queda de respaldo)', async () => {
    const h = await setup();
    pick(h, 1);
    h.component.party.set('insurer');
    expect(h.component.waitSuppliers().map((x) => x.id)).toEqual(['s2']);
    h.component.waitSupplierId.set('s2');
    expect(h.component.built().body).toMatchObject({ decision: 'start_wait', party: 'insurer', supplierId: 's2', dueInHours: 72 });
    expect(h.component.built().body).not.toHaveProperty('partyLabel');
    h.component.party.set('provider');
    h.component.waitSupplierId.set('');
    expect(h.component.waitSuppliers().map((x) => x.id)).toEqual(['s1']);
    h.component.party.set('owner');
    expect(h.component.waitSuppliers()).toEqual([]);
    h.component.partyLabel.set('La propietaria del 3ºB');
    expect(h.component.built().body).toMatchObject({ party: 'owner', partyLabel: 'La propietaria del 3ºB' });
  });

  it('la visita puede ser de un proveedor, del profesional asignado o de un nombre suelto', async () => {
    const h = await setup({ providerNameSnapshot: 'Fontanería Pepe' });
    pick(h, 2);
    expect(h.component.assignedProfessional()).toBe('Fontanería Pepe');
    expect(h.component.visitSuppliers().map((x) => x.id)).toEqual(['s1']);
    h.component.visitWho.set('s1');
    expect(h.component.built().body).toMatchObject({ decision: 'schedule_visit', supplierId: 's1' });
    h.component.visitWho.set('assigned');
    expect(h.component.built().body).toMatchObject({ decision: 'schedule_visit', useAssignedProfessional: true });
    expect(h.component.built().body).not.toHaveProperty('visitorLabel');
    h.component.visitWho.set('');
    h.component.visitor.set('Peritos SL');
    expect(h.component.built().body).toMatchObject({ visitorLabel: 'Peritos SL' });
  });

  it('muestra el motivo del servidor si rechaza la revisión', async () => {
    const h = await setup();
    pick(h, 5);
    const done = h.component.submit();
    h.http.expectOne(`${API}/agenda/tasks/t1/resolution`).flush({ message: 'La incidencia se quedaría sin siguiente paso.' }, { status: 409, statusText: 'Conflict' });
    await done;
    expect(h.component.problem()).toContain('sin siguiente paso');
  });
});
