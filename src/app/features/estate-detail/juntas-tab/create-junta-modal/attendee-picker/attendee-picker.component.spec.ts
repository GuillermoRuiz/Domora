import { TestBed } from '@angular/core/testing';
import type { JuntaAttendee, JuntaOwner } from '../junta-draft.store';
import { AttendeePickerComponent } from './attendee-picker.component';

const owners: JuntaOwner[] = [
  { email: 'lucia@demo.app', fullName: 'Lucía Fernández' },
  { email: 'javier@demo.app', fullName: 'Javier Moreno' },
  { email: 'carlos@demo.app', fullName: 'Carlos Ruiz' },
];

function setup(attendees: JuntaAttendee[] = []) {
  TestBed.configureTestingModule({ imports: [AttendeePickerComponent] });
  const fixture = TestBed.createComponent(AttendeePickerComponent);
  fixture.componentRef.setInput('attendees', attendees);
  fixture.componentRef.setInput('owners', owners);
  fixture.detectChanges();
  const emitted: JuntaAttendee[][] = [];
  fixture.componentInstance.attendeesChange.subscribe((a) => emitted.push(a));
  return { fixture, component: fixture.componentInstance, emitted };
}

describe('AttendeePickerComponent', () => {
  it('only offers owners that are not selected yet', () => {
    const { component } = setup([{ email: 'lucia@demo.app', name: 'Lucía Fernández' }]);
    expect(component.options().map((o) => o.email)).toEqual(['javier@demo.app', 'carlos@demo.app']);
  });

  it('filters owners by name or email', () => {
    const { component } = setup();
    component.query.set('mor');
    expect(component.options().map((o) => o.email)).toEqual(['javier@demo.app']);
    component.query.set('CARLOS@');
    expect(component.options().map((o) => o.email)).toEqual(['carlos@demo.app']);
  });

  it('adds an owner keeping the real name', () => {
    const { component, emitted } = setup();
    component.add(component.options()[1]);
    expect(emitted.at(-1)).toEqual([{ email: 'javier@demo.app', name: 'Javier Moreno' }]);
  });

  it('offers to add a typed email that is not an owner, and adds it by email only', () => {
    const { component, emitted } = setup();
    component.query.set('externo@example.com');
    expect(component.options().at(-1)).toMatchObject({ kind: 'custom', email: 'externo@example.com' });
    component.addTyped();
    expect(emitted.at(-1)).toEqual([{ email: 'externo@example.com', name: undefined }]);
  });

  it('resolves a typed owner email to the owner name', () => {
    const { component, emitted } = setup();
    component.query.set('lucia@demo.app');
    component.addTyped();
    expect(emitted.at(-1)).toEqual([{ email: 'lucia@demo.app', name: 'Lucía Fernández' }]);
  });

  it('rejects text that is not an email', () => {
    const { component, emitted } = setup();
    component.query.set('no es un email');
    component.addTyped();
    expect(emitted.length).toBe(0);
    expect(component.invalidEmail()).toBe(true);
  });

  it('does not duplicate attendees, ignoring case', () => {
    const { component, emitted } = setup([{ email: 'lucia@demo.app', name: 'Lucía' }]);
    component.query.set('LUCIA@demo.app');
    component.addTyped();
    expect(emitted.length).toBe(0);
  });

  it('adds several emails pasted at once and flags the invalid ones', () => {
    const { component, emitted } = setup();
    const preventDefault = vi.fn();
    component.onPaste({
      preventDefault,
      clipboardData: { getData: () => 'a@x.com, b@x.com; nope' },
    } as unknown as ClipboardEvent);
    expect(preventDefault).toHaveBeenCalled();
    expect(emitted.at(-1)?.map((a) => a.email)).toEqual(['a@x.com', 'b@x.com']);
    expect(component.invalidEmail()).toBe(true);
  });

  it('removes one attendee or all of them', () => {
    const attendees = [
      { email: 'a@x.com' },
      { email: 'b@x.com' },
    ];
    const { component, emitted } = setup(attendees);
    component.remove('a@x.com');
    expect(emitted.at(-1)).toEqual([{ email: 'b@x.com' }]);
    component.clearAll();
    expect(emitted.at(-1)).toEqual([]);
  });

  it('adds every owner at once without duplicating the ones already selected', () => {
    const { fixture, component, emitted } = setup([{ email: 'lucia@demo.app', name: 'Lucía Fernández' }]);
    expect(component.allSelected()).toBe(false);
    component.addAll();
    expect(emitted.at(-1)?.map((a) => a.email)).toEqual(['lucia@demo.app', 'javier@demo.app', 'carlos@demo.app']);
    fixture.componentRef.setInput('attendees', emitted.at(-1));
    expect(component.allSelected()).toBe(true);
  });

  it('shows the name when known and the email otherwise, with initials', () => {
    const { component } = setup();
    expect(component.displayName({ email: 'a@x.com', name: 'Lucía Fernández' })).toBe('Lucía Fernández');
    expect(component.displayName({ email: 'a@x.com' })).toBe('a@x.com');
    expect(component.initials({ email: 'a@x.com', name: 'Lucía Fernández Ortega' })).toBe('LO');
    expect(component.initials({ email: 'zz@x.com' })).toBe('ZZ');
  });

  it('closes only the list (not the modal) on Escape when it is open', () => {
    const { component } = setup();
    component.open.set(true);
    const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    const stop = vi.spyOn(event, 'stopPropagation');
    component.onKeydown(event);
    expect(stop).toHaveBeenCalled();
    expect(component.open()).toBe(false);
  });
});
