import { API, setupComponent, settle, type ComponentHarness } from '../../../core/testing/component-harness';
import type { AgendaTaskDetail } from '../../../core/agenda-tasks.model';
import { TaskDecisionPanelComponent } from './task-decision-panel.component';

function makeTask(over: Partial<AgendaTaskDetail> = {}): AgendaTaskDetail {
  return {
    id: 't1', title: 'Confirmar la visita de Ascensores Levante — #INC-2026-001', kind: 'confirm_visit_outcome',
    issueId: 'i1', estate: { id: 'e1', name: 'Residencial Demo' }, payload: { visitId: 'v1' },
    status: 'PENDIENTE',
    ...over,
  } as AgendaTaskDetail;
}

let h: ComponentHarness<TaskDecisionPanelComponent>;

function mount(task: AgendaTaskDetail): void {
  h = setupComponent(TaskDecisionPanelComponent);
  h.fixture.componentRef.setInput('task', task);
  h.fixture.detectChanges();
}

const buttons = (): HTMLButtonElement[] => Array.from(h.el.querySelectorAll('.decision__btn'));
const click = (label: string): void => {
  buttons().find((b) => b.textContent?.includes(label))!.click();
};

describe('TaskDecisionPanelComponent', () => {
  afterEach(() => h.http.verify());

  describe('el resto de decisiones', () => {
    it('reclamar a un proveedor: seguir esperando con un plazo elegido', () => {
      mount(makeTask({ kind: 'chase_provider', payload: { waitId: 'w1' } }));
      const select = h.el.querySelector('.decision__extend select') as HTMLSelectElement;
      select.value = '72';
      select.dispatchEvent(new Event('change'));
      click('Seguir esperando');

      const req = h.http.expectOne((r) => r.method === 'POST' && r.url === `${API}/agenda/tasks/t1/resolution`);
      expect(req.request.body).toEqual({ result: { decision: 'wait_more', extendHours: 72 } });
      req.flush(makeTask({ status: 'COMPLETADA' }));
    });

    it('visita vencida: «se realizó» o «no se realizó / se canceló»', () => {
      mount(makeTask({ kind: 'confirm_visit_outcome', payload: { visitId: 'v1' } }));
      expect(buttons().map((b) => b.textContent?.trim())).toEqual(['Se realizó', 'No se realizó / se canceló']);
      click('Se realizó');
      const req = h.http.expectOne((r) => r.method === 'POST' && r.url === `${API}/agenda/tasks/t1/resolution`);
      expect(req.request.body).toEqual({ result: { decision: 'completed' } });
      req.flush(makeTask({ status: 'COMPLETADA' }));
    });

    it('informar al solicitante: enviar o no informar', () => {
      mount(makeTask({ kind: 'inform_requester' }));
      expect(buttons().map((b) => b.textContent?.trim())).toEqual(['Informar al solicitante', 'No informar']);
    });

    it('una revisión no muestra panel: se cierra con «Completada»', () => {
      mount(makeTask({ kind: 'review_issue' }));
      expect(h.el.querySelector('.decision')).toBeNull();
    });

    it('un tipo cuya resolución el backend aún no admite no ofrece botones inventados', () => {
      mount(makeTask({ kind: 'approve_quote' }));
      expect(h.el.querySelector('.decision')).toBeNull();
    });

    it('una tarea manual (sin tipo de decisión) no muestra el panel', () => {
      mount(makeTask({ kind: null }));
      expect(h.el.querySelector('.decision')).toBeNull();
    });

    it('si el servidor rechaza la decisión, se enseña su motivo y se puede reintentar', async () => {
      mount(makeTask());
      click('Se realizó');
      h.http.expectOne((r) => r.method === 'POST').flush({ message: 'Esta decisión ya se está resolviendo.' }, { status: 409, statusText: 'Conflict' });
      await settle();
      h.fixture.detectChanges();

      expect(h.el.querySelector('.decision__error')?.textContent).toContain('ya se está resolviendo');
      expect(buttons().every((b) => !b.disabled)).toBe(true);
    });

    it('mientras se resuelve no se pueden mandar dos decisiones', () => {
      mount(makeTask());
      click('Se realizó');
      h.fixture.detectChanges();
      expect(buttons().every((b) => b.disabled)).toBe(true);
      click('Se realizó');
      h.http.expectOne((r) => r.method === 'POST').flush(makeTask({ status: 'COMPLETADA' }));
    });
  });
});
