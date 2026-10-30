import { setupComponent } from '../../../../core/testing/component-harness';
import type { AttendanceStatus, ParticipationRow, ParticipationStats } from '../meeting-workspace.model';
import { MeetingParticipationTabComponent } from './participation-tab.component';

const row = (status: AttendanceStatus, propertyId = 'p1'): ParticipationRow => ({
  propertyId,
  owner: 'Ana Pérez',
  initials: 'AP',
  unit: '1A',
  status,
  statusLabel: status,
  representedBy: status === 'representado' ? 'Marta Gil' : null,
  representedByDni: status === 'representado' ? '12345678Z' : null,
  delegationId: status === 'representado' ? 'd1' : null,
  representativeUserId: null,
  attendanceIds: [],
  representativeAttendanceIds: [],
  quota: '4%',
  quotaValue: 4,
  group: '',
  hasVote: status !== 'ausente',
  voteLabel: 'x',
});
const stats = {
  attending: 1,
  totalOwners: 3,
  represented: 0,
  ownersPercent: 0,
  quotaPercent: 10,
  quorumTone: 'green',
  quorumLabel: 'Quórum alcanzado',
  quorumHint: '',
} as ParticipationStats;

function setup(status: AttendanceStatus, canRegister = true) {
  const h = setupComponent(MeetingParticipationTabComponent);
  h.fixture.componentRef.setInput('rows', [row(status)]);
  h.fixture.componentRef.setInput('stats', stats);
  h.fixture.componentRef.setInput('canRegister', canRegister);
  h.fixture.detectChanges();
  return h;
}
const open = (h: ReturnType<typeof setup>) => {
  (h.el.querySelector('.row-menu__trigger') as HTMLButtonElement).click();
  h.fixture.detectChanges();
};
const items = (h: ReturnType<typeof setup>) =>
  Array.from(h.el.querySelectorAll('.row-menu [role="menuitem"]')).map((item) => item.textContent?.trim());

describe('MeetingParticipationTabComponent row menu', () => {
  it('offers absent and representation for a present owner', () => {
    const h = setup('presente');
    open(h);
    expect(items(h)).toEqual(['Marcar como ausente', 'Registrar representación']);
  });

  it('offers present and representation for an absent owner', () => {
    const h = setup('ausente');
    open(h);
    expect(items(h)).toEqual(['Marcar como presente', 'Registrar representación']);
  });

  it('offers change, remove, present and absent for a represented owner', () => {
    const h = setup('representado');
    open(h);
    expect(items(h)).toEqual([
      'Cambiar representante',
      'Quitar representación',
      'Marcar como presente',
      'Marcar como ausente',
    ]);
  });

  it('shows the DNI of an external representative', () => {
    const h = setup('representado');
    expect(h.el.querySelector('td[data-label="Representación"]')?.textContent).toContain('DNI 12345678Z');
  });

  it('emits the chosen action with the row and closes the menu', () => {
    const h = setup('presente');
    const represent = vi.fn();
    const markAbsent = vi.fn();
    h.component.represent.subscribe(represent);
    h.component.markAbsent.subscribe(markAbsent);
    open(h);
    (h.el.querySelectorAll('.row-menu [role="menuitem"]')[1] as HTMLButtonElement).click();
    h.fixture.detectChanges();
    expect(represent).toHaveBeenCalledWith(expect.objectContaining({ propertyId: 'p1', status: 'presente' }));
    expect(markAbsent).not.toHaveBeenCalled();
    expect(h.el.querySelector('.row-menu')).toBeNull();
  });

  it('closes the menu with Escape', () => {
    const h = setup('presente');
    open(h);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    h.fixture.detectChanges();
    expect(h.el.querySelector('.row-menu')).toBeNull();
  });

  it('disables the menu when attendance cannot be registered', () => {
    const h = setup('presente', false);
    expect((h.el.querySelector('.row-menu__trigger') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('MeetingParticipationTabComponent several holders', () => {
  const holders = [{ userId: 'h1', name: 'Marta Vega' }, { userId: 'h2', name: 'Pablo Ruiz' }];
  function withHolders(over: Partial<ParticipationRow>, canRegister = true) {
    const h = setupComponent(MeetingParticipationTabComponent);
    h.fixture.componentRef.setInput('rows', [{ ...row('ausente'), holders, holderUserId: 'h1', owner: 'Marta Vega', ...over }]);
    h.fixture.componentRef.setInput('stats', stats);
    h.fixture.componentRef.setInput('canRegister', canRegister);
    h.fixture.detectChanges();
    return h;
  }

  it('shows the property, a dash and a dropdown with every holder, and emits the one chosen', () => {
    const h = withHolders({});
    const select = h.el.querySelector('.owner__select') as HTMLSelectElement;
    expect(h.el.querySelector('.owner')?.textContent).toContain('1A -');
    expect(Array.from(select.options).map((option) => option.textContent?.trim())).toEqual(['Marta Vega', 'Pablo Ruiz']);
    expect(select.value).toBe('h1');
    const chosen = vi.fn();
    h.component.holderChosen.subscribe(chosen);
    select.value = 'h2';
    select.dispatchEvent(new Event('change'));
    expect(chosen).toHaveBeenCalledWith({ row: expect.objectContaining({ propertyId: 'p1' }), userId: 'h2' });
  });

  it('shows the plain name with a single holder', () => {
    expect(withHolders({ holders: [holders[0]] }).el.querySelector('.owner__select')).toBeNull();
  });

  it('shows the plain name for a represented property', () => {
    expect(withHolders({ status: 'representado' }).el.querySelector('.owner__select')).toBeNull();
  });

  it('shows the plain name once the meeting no longer accepts attendance changes', () => {
    const closed = withHolders({}, false);
    expect(closed.el.querySelector('.owner__select')).toBeNull();
    expect(closed.el.querySelector('.owner')?.textContent?.replace(/\s+/g, ' ')).toContain('1A - Marta Vega');
  });
});

