import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DateRangePickerComponent } from './date-range-picker.component';
import { DateRange, addDays, fromIsoDate, toIsoDate } from './date-range.util';

@Component({
  standalone: true,
  imports: [DateRangePickerComponent],
  template: `<app-date-range-picker [value]="range()" (valueChange)="range.set($event); changes.push($event)"></app-date-range-picker>`,
})
class HostComponent {
  range = signal<DateRange | null>(null);
  changes: (DateRange | null)[] = [];
}

describe('DateRangePickerComponent', () => {
  const today = toIsoDate(new Date());

  function setup() {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    const q = (selector: string) => root.querySelector<HTMLElement>(selector);
    const label = (iso: string) => fromIsoDate(iso)!.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const day = (iso: string) => q(`.drp__day[aria-label="${label(iso)}"]`)!;
    const open = () => { q('.drp__trigger')!.click(); fixture.detectChanges(); };
    return { fixture, host: fixture.componentInstance, q, day, label, open };
  }

  it('muestra el texto por defecto y no abre el calendario hasta pulsar', () => {
    const { q } = setup();
    expect(q('.drp__text')!.textContent).toContain('Fecha: todas');
    expect(q('.drp__panel')).toBeNull();
  });

  it('elegir dos días emite el rango ordenado y cierra el calendario', () => {
    const { fixture, host, q, day, open } = setup();
    open();
    const later = today; const earlier = addDays(today, -2);
    day(later).click(); fixture.detectChanges();
    expect(host.changes).toEqual([]);
    expect(q('.drp__hint')!.textContent).toContain('elige el último día');
    day(earlier).click(); fixture.detectChanges();
    expect(host.changes).toEqual([{ from: earlier, to: later }]);
    expect(q('.drp__panel')).toBeNull();
    expect(q('.drp__text')!.textContent).not.toContain('Fecha: todas');
  });

  it('pulsar el mismo día dos veces da un rango de un solo día', () => {
    const { fixture, host, day, open } = setup();
    open();
    day(today).click(); fixture.detectChanges();
    day(today).click(); fixture.detectChanges();
    expect(host.changes).toEqual([{ from: today, to: today }]);
  });

  it('un atajo aplica su rango y cierra', () => {
    const { fixture, host, q, open } = setup();
    open();
    q('.drp__preset')!.click(); fixture.detectChanges();
    expect(host.changes).toEqual([{ from: today, to: today }]);
    expect(q('.drp__panel')).toBeNull();
  });

  it('quitar el filtro emite null', () => {
    const { fixture, host, q } = setup();
    host.range.set({ from: today, to: today }); fixture.detectChanges();
    q('.drp__clear')!.click(); fixture.detectChanges();
    expect(host.changes).toEqual([null]);
    expect(q('.drp__clear')).toBeNull();
  });

  it('Escape y un clic fuera cierran el calendario', () => {
    const { fixture, q, open } = setup();
    open();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); fixture.detectChanges();
    expect(q('.drp__panel')).toBeNull();
    open();
    document.body.click(); fixture.detectChanges();
    expect(q('.drp__panel')).toBeNull();
  });

  it('las flechas mueven el día enfocado', () => {
    const { fixture, q, day, label, open } = setup();
    open();
    day(today).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); fixture.detectChanges();
    expect(q('.drp__day[tabindex="0"]')!.getAttribute('aria-label')).toBe(label(addDays(today, 1)));
  });

  it('pinta el inicio y el fin del rango aplicado', () => {
    const { fixture, host, q, open } = setup();
    host.range.set({ from: addDays(today, -1), to: today }); fixture.detectChanges();
    open();
    expect(q('.drp__cell--start')).not.toBeNull();
    expect(q('.drp__cell--end')).not.toBeNull();
  });
});
