import { TestBed } from '@angular/core/testing';
import {
  DatetimeFieldComponent,
  buildMonth,
  formatDate,
  maskTime,
  parseTime,
} from './datetime-field.component';

function typed(value: string): Event {
  return { target: { value } } as unknown as Event;
}

describe('junta datetime helpers', () => {
  it('masks times as hh:mm from digits only', () => {
    expect(maskTime('18')).toBe('18');
    expect(maskTime('1830')).toBe('18:30');
    expect(maskTime('18:30')).toBe('18:30');
    expect(maskTime('ab18cd3')).toBe('18:3');
    expect(maskTime('0905')).toBe('09:05');
  });

  it('clamps out-of-range hours to 23 and minutes to 59 as they are typed', () => {
    expect(maskTime('92')).toBe('23');
    expect(maskTime('24')).toBe('23');
    expect(maskTime('99')).toBe('23');
    expect(maskTime('9219')).toBe('23:19');
    expect(maskTime('2560')).toBe('23:59');
    expect(maskTime('1875')).toBe('18:59');
    expect(maskTime('1860')).toBe('18:59');
    expect(maskTime('2359')).toBe('23:59');
    expect(maskTime('0000')).toBe('00:00');
    // minutos a medio escribir no se tocan (el primer dígito siempre es válido o se ajusta al completar)
    expect(maskTime('187')).toBe('18:7');
  });

  it('parses only valid 24h times', () => {
    expect(parseTime('18:30')).toBe('18:30');
    expect(parseTime('00:00')).toBe('00:00');
    expect(parseTime('24:00')).toBe('');
    expect(parseTime('12:60')).toBe('');
    expect(parseTime('1:30')).toBe('');
  });

  it('formats dates in Spanish order regardless of the browser language', () => {
    expect(formatDate('2027-01-15')).toBe('15/01/2027');
    expect(formatDate('')).toBe('');
  });

  it('builds only the weeks the month needs, starting on Monday', () => {
    const jan = buildMonth(2027, 0, '2027-01-15'); // 1 ene 2027 = viernes → 4 huecos + 31 días = 5 semanas
    expect(jan.length).toBe(35);
    expect(jan[0].iso).toBe('2026-12-28');
    expect(jan[0].inMonth).toBe(false);
    expect(jan[4].iso).toBe('2027-01-01');
    expect(jan[4].inMonth).toBe(true);
    expect(jan[4].label).toBe('1 de enero de 2027');
    expect(jan.find((c) => c.today)?.iso).toBe('2027-01-15');
    expect(jan.filter((c) => c.inMonth).length).toBe(31);

    expect(buildMonth(2027, 1, '').length).toBe(28); // feb 2027 empieza en lunes: 4 semanas exactas
    expect(buildMonth(2026, 7, '').length).toBe(42); // ago 2026 empieza en sábado: 6 semanas
  });
});

describe('DatetimeFieldComponent', () => {
  function setup(value = '') {
    TestBed.configureTestingModule({ imports: [DatetimeFieldComponent] });
    const fixture = TestBed.createComponent(DatetimeFieldComponent);
    fixture.componentRef.setInput('label', '1ª convocatoria');
    fixture.componentRef.setInput('value', value);
    fixture.detectChanges();
    const emitted: string[] = [];
    fixture.componentInstance.valueChange.subscribe((v) => emitted.push(v));
    return { fixture, component: fixture.componentInstance, emitted, el: fixture.nativeElement as HTMLElement };
  }

  it('shows an incoming value in Spanish format (dd/mm/aaaa · hh:mm)', () => {
    const { component, el } = setup('2027-01-15T18:30');
    expect(component.dateText()).toBe('15/01/2027');
    expect(component.timeText()).toBe('18:30');
    expect(el.querySelector('.dtf__value')?.textContent).toContain('15/01/2027');
  });

  it('shows a placeholder and an accessible name while no date is chosen', () => {
    const { el } = setup();
    const trigger = el.querySelector<HTMLButtonElement>('button.dtf__control')!;
    expect(trigger.textContent).toContain('Seleccionar fecha');
    expect(trigger.getAttribute('aria-label')).toBe('1ª convocatoria: fecha, sin seleccionar');
  });

  it('describes the chosen date for screen readers', () => {
    const { el } = setup('2027-01-15T18:30');
    expect(el.querySelector('button.dtf__control')?.getAttribute('aria-label')).toBe(
      '1ª convocatoria: fecha, 15 de enero de 2027',
    );
  });

  it('emits the same YYYY-MM-DDTHH:mm value the datetime-local input used to, only when complete', () => {
    const { component, emitted } = setup();
    component.selectDay('2027-01-15');
    expect(emitted.at(-1)).toBe('');
    component.onTimeInput(typed('1830'));
    expect(emitted.at(-1)).toBe('2027-01-15T18:30');
    component.onTimeInput(typed('18'));
    expect(emitted.at(-1)).toBe('');
  });

  it('adjusts an impossible time instead of rejecting it', () => {
    const { component, emitted } = setup();
    component.selectDay('2027-01-15');
    component.onTimeInput(typed('9219'));
    expect(component.timeText()).toBe('23:19');
    expect(emitted.at(-1)).toBe('2027-01-15T23:19');
    component.onTimeInput(typed('1875'));
    expect(component.timeText()).toBe('18:59');
    expect(emitted.at(-1)).toBe('2027-01-15T18:59');
  });

  it('writes the adjusted value back into the input element', () => {
    const { component } = setup();
    const input = { value: '9219' } as HTMLInputElement;
    component.onTimeInput({ target: input } as unknown as Event);
    expect(input.value).toBe('23:19');
  });

  it('does not overwrite what is being typed when the parent echoes the value back', () => {
    const { fixture, component } = setup();
    component.onTimeInput(typed('18'));
    fixture.componentRef.setInput('value', ''); // eco del padre: sigue incompleto
    fixture.detectChanges();
    expect(component.timeText()).toBe('18');
  });

  it('syncs external changes such as a form reset or a suggested value', () => {
    const { fixture, component } = setup('2027-01-15T18:30');
    fixture.componentRef.setInput('value', '');
    fixture.detectChanges();
    expect(component.dateText()).toBe('');
    expect(component.timeText()).toBe('');
    fixture.componentRef.setInput('value', '2027-02-01T09:00');
    fixture.detectChanges();
    expect(component.dateText()).toBe('01/02/2027');
    expect(component.timeText()).toBe('09:00');
  });

  it('shows the hint under the field when given', () => {
    const { fixture, el } = setup();
    expect(el.querySelector('.dtf__hint')).toBeNull();
    fixture.componentRef.setInput('hint', 'Sugerida 30 min después de la 1ª. Puedes cambiarla.');
    fixture.detectChanges();
    expect(el.querySelector('.dtf__hint')?.textContent).toContain('Sugerida 30 min');
  });

  describe('calendar popover', () => {
    function open(value = '') {
      const ctx = setup(value);
      const trigger = ctx.el.querySelector<HTMLButtonElement>('button.dtf__control')!;
      ctx.component.openPopover(trigger);
      ctx.fixture.detectChanges();
      return { ...ctx, trigger, popover: () => ctx.el.querySelector('.dtf-pop') };
    }

    it('opens on the selected month, or the current one when empty', () => {
      const { component, popover, trigger } = open('2027-03-09T10:00');
      expect(popover()).not.toBeNull();
      expect(component.view()).toEqual({ year: 2027, month: 2 });
      expect(component.monthLabel()).toBe('Marzo de 2027');
      expect(component.focusIso()).toBe('2027-03-09');
      expect(trigger.getAttribute('aria-expanded')).toBe('true');
    });

    it('only shows the days of the month (no days from neighbouring months)', () => {
      const { el } = open('2027-01-15T10:00');
      expect(el.querySelectorAll('.cal-day').length).toBe(31);
      expect(el.querySelectorAll('.cal-blank').length).toBe(4);
      expect(el.querySelector('.cal-day--selected')?.textContent?.trim()).toBe('15');
    });

    it('picking a day fills the date, emits when the time is set, and closes the popover', () => {
      const { component, emitted, fixture, popover } = open();
      component.onTimeInput(typed('1830'));
      component.selectDay('2027-01-15');
      fixture.detectChanges();
      expect(component.dateText()).toBe('15/01/2027');
      expect(emitted.at(-1)).toBe('2027-01-15T18:30');
      expect(component.open()).toBe(false);
      expect(popover()).toBeNull();
    });

    it('clicking a day in the grid does the same', () => {
      const { fixture, el, component, emitted } = open('2027-01-15T18:30');
      el.querySelector<HTMLButtonElement>('[data-iso="2027-01-20"]')!.click();
      fixture.detectChanges();
      expect(component.dateText()).toBe('20/01/2027');
      expect(emitted.at(-1)).toBe('2027-01-20T18:30');
      expect(el.querySelector('.dtf-pop')).toBeNull();
    });

    it('navigates months and clamps the focused day', () => {
      const { component } = open('2027-01-31T10:00');
      component.shiftMonth(1);
      expect(component.view()).toEqual({ year: 2027, month: 1 });
      expect(component.focusIso()).toBe('2027-02-28');
      component.shiftMonth(-2);
      expect(component.view()).toEqual({ year: 2026, month: 11 });
    });

    it('moves with the keyboard: arrows, weeks, week edges, months and years', () => {
      const { component } = open('2027-01-15T10:00'); // viernes
      const key = (k: string, shiftKey = false) => {
        const e = new KeyboardEvent('keydown', { key: k, shiftKey, cancelable: true });
        component.onDayKeydown(e);
        return e.defaultPrevented;
      };
      expect(key('ArrowRight')).toBe(true);
      expect(component.focusIso()).toBe('2027-01-16');
      key('ArrowDown');
      expect(component.focusIso()).toBe('2027-01-23');
      key('ArrowLeft');
      key('ArrowUp');
      expect(component.focusIso()).toBe('2027-01-15');
      key('Home');
      expect(component.focusIso()).toBe('2027-01-11'); // lunes
      key('End');
      expect(component.focusIso()).toBe('2027-01-17'); // domingo
      key('ArrowRight'); // cruza de mes
      key('ArrowRight');
      key('PageDown');
      expect(component.view().month).toBe(1);
      key('PageDown', true); // Mayús: +1 año
      expect(component.view()).toEqual({ year: 2028, month: 1 });
      expect(key('a')).toBe(false);
    });

    it('marks today and the selected day for assistive tech', () => {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      const { el } = open(`${today}T10:00`);
      expect(el.querySelector('.cal-day--today')?.getAttribute('aria-current')).toBe('date');
      expect(el.querySelector('.cal-day--selected')?.getAttribute('aria-pressed')).toBe('true');
    });

    it('Escape closes only the popover and is marked as handled', () => {
      const { component, fixture } = open();
      const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
      component.onEscape(event);
      fixture.detectChanges();
      expect(event.defaultPrevented).toBe(true);
      expect(component.open()).toBe(false);
      // sin popover abierto no intercepta el Escape (lo gestiona el modal)
      const second = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
      component.onEscape(second);
      expect(second.defaultPrevented).toBe(false);
    });

    it('closes when clicking outside, and stays open for clicks inside', () => {
      const { component, el } = open();
      el.querySelector('.cal-title')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      expect(component.open()).toBe(true);
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      expect(component.open()).toBe(false);
    });

    it('toggles from the date button', () => {
      const { component, trigger } = open();
      component.openPopover(trigger);
      expect(component.open()).toBe(false);
    });
  });
});
