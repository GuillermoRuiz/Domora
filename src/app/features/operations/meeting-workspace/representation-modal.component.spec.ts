import { setupComponent } from '../../../core/testing/component-harness';
import type { ParticipationRow } from './meeting-workspace.model';
import { MeetingRepresentationModalComponent } from './representation-modal.component';

const row = (status: ParticipationRow['status'] = 'ausente'): ParticipationRow => ({
  propertyId: 'p1',
  owner: 'Ana Pérez',
  initials: 'AP',
  unit: '1A',
  status,
  statusLabel: status,
  representedBy: status === 'representado' ? 'Luis Martín' : null,
  representedByDni: null,
  delegationId: null,
  representativeUserId: null,
  attendanceIds: [],
  representativeAttendanceIds: [],
  quota: '4%',
  quotaValue: 4,
  group: '',
  hasVote: false,
  voteLabel: '',
});

function setup(owners: { email: string; fullName: string }[] | null, status: ParticipationRow['status'] = 'ausente') {
  const h = setupComponent(MeetingRepresentationModalComponent);
  h.fixture.componentRef.setInput('row', row(status));
  h.fixture.componentRef.setInput('owners', owners);
  h.fixture.detectChanges();
  return h;
}
const root = (h: ReturnType<typeof setup>) => h.fixture.nativeElement as HTMLElement;
const type = (h: ReturnType<typeof setup>, selector: string, value: string) => {
  const input = root(h).querySelector(selector) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input'));
  h.fixture.detectChanges();
};
const submit = (h: ReturnType<typeof setup>) => {
  (Array.from(root(h).querySelectorAll('.modal__footer button')).pop() as HTMLButtonElement).click();
  h.fixture.detectChanges();
};

describe('MeetingRepresentationModalComponent', () => {
  it('titles the dialog "Registrar representación" for an owner without one', () => {
    expect(root(setup([])).querySelector('h4')?.textContent).toContain('Registrar representación');
  });

  it('titles the dialog "Cambiar representante" for an already represented owner', () => {
    expect(root(setup([], 'representado')).querySelector('h4')?.textContent).toContain('Cambiar representante');
  });

  it('starts with an owner dropdown and emits the chosen owner', () => {
    const h = setup([{ email: 'luis@x.com', fullName: 'Luis Martín' }]);
    const confirm = vi.fn();
    h.component.confirm.subscribe(confirm);
    expect(root(h).querySelector('select')).not.toBeNull();
    expect(root(h).querySelector('input[type="text"]')).toBeNull();

    submit(h);
    expect(confirm).not.toHaveBeenCalled();
    expect(root(h).textContent).toContain('Elige quién le representa');

    const select = root(h).querySelector('select') as HTMLSelectElement;
    select.value = 'luis@x.com';
    select.dispatchEvent(new Event('change'));
    h.fixture.detectChanges();
    submit(h);
    expect(confirm).toHaveBeenCalledWith({ owner: { email: 'luis@x.com' }, external: null });
  });

  it('asks for full name and a valid DNI when the representative is not an owner', () => {
    const h = setup([{ email: 'luis@x.com', fullName: 'Luis Martín' }]);
    const confirm = vi.fn();
    h.component.confirm.subscribe(confirm);
    h.component.isOwner.set(false);
    h.fixture.detectChanges();
    expect(root(h).querySelector('select')).toBeNull();

    type(h, 'input[placeholder="Nombre y apellidos"]', 'Marta Gil Soto');
    type(h, 'input[placeholder="12345678Z"]', '12345678A');
    submit(h);
    expect(confirm).not.toHaveBeenCalled();
    expect(root(h).textContent).toContain('El DNI/NIE no es válido');

    type(h, 'input[placeholder="12345678Z"]', '12.345.678-z');
    submit(h);
    expect(confirm).toHaveBeenCalledWith({ owner: null, external: { name: 'Marta Gil Soto', dni: '12.345.678-z' } });
  });

  it('falls back to an external person when the community has no owners to pick', () => {
    const h = setup([]);
    expect(h.component.isOwner()).toBe(false);
    expect(root(h).querySelector('input[type="text"]')).not.toBeNull();
  });

  it('does not close while saving', () => {
    const h = setup([]);
    h.fixture.componentRef.setInput('busy', true);
    h.fixture.detectChanges();
    const closed = vi.fn();
    h.component.closed.subscribe(closed);
    h.component.close();
    expect(closed).not.toHaveBeenCalled();
  });
});
