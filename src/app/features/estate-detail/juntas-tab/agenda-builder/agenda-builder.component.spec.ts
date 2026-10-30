import { TestBed } from '@angular/core/testing';
import type { AgendaItem } from '../../../../core/models';
import { AgendaBuilderComponent, newAgendaItem } from './agenda-builder.component';

const items: AgendaItem[] = [
  { id: 'a', title: 'Cuentas', description: 'Del ejercicio', hasVote: true, voteTemplate: { questions: [{ title: '¿Aprueba?', type: 'single_choice', options: ['Sí', 'No'], majorityType: 'mayoriaSimple' }] } },
  { id: 'b', title: 'Ascensor', description: '', hasVote: false },
  { id: 'c', title: 'Ruegos', description: '', hasVote: false },
];

function setup(value: AgendaItem[] = items) {
  TestBed.configureTestingModule({ imports: [AgendaBuilderComponent] });
  const fixture = TestBed.createComponent(AgendaBuilderComponent);
  fixture.componentRef.setInput('items', value);
  fixture.detectChanges();
  const emitted: AgendaItem[][] = [];
  fixture.componentInstance.itemsChange.subscribe((v) => emitted.push(v));
  return { fixture, component: fixture.componentInstance, emitted, el: fixture.nativeElement as HTMLElement };
}

describe('AgendaBuilderComponent', () => {
  it('warns and protects accounts/budget in ordinary meetings, but allows officers deletion', () => {
    const { fixture, component, el } = setup([
      { id: 'accounts', title: 'Cuentas editadas', systemKey: 'annual_accounts_approval', systemGenerated: true },
      { id: 'budget', title: 'Presupuesto', systemKey: 'annual_budget_approval', systemGenerated: true },
      { id: 'officers', title: 'Cargos', systemKey: 'community_officers_appointment', systemGenerated: true },
    ]);
    fixture.componentRef.setInput('meetingType', 'ordinaria');
    fixture.detectChanges();
    el.querySelector<HTMLButtonElement>('[aria-label="Eliminar punto 1"]')!.click();
    component.removeItem('budget');
    fixture.detectChanges();
    expect(component.items).toHaveLength(3);
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Junta Ordinaria anual');
    component.removeItem('officers');
    expect(component.items.map(i => i.id)).toEqual(['accounts', 'budget']);
    fixture.componentRef.setInput('meetingType', 'extraordinaria');
    component.removeItem('accounts');
    expect(component.items.map(i => i.id)).toEqual(['budget']);
  });
  it('starts with a single blank point when empty', () => {
    const { component } = setup([]);
    expect(component.items.length).toBe(1);
    expect(component.items[0].title).toBe('');
    expect(newAgendaItem().id).not.toBe(newAgendaItem().id);
  });

  it('reorders points keeping every field (description, votes), numbering follows position', () => {
    const { component, emitted, fixture, el } = setup();
    component.move(2, 0);
    fixture.detectChanges();
    expect(emitted.at(-1)?.map((i) => i.id)).toEqual(['c', 'a', 'b']);
    expect(emitted.at(-1)?.[1]).toEqual(items[0]);
    const numbers = Array.from(el.querySelectorAll('.agenda-card__index')).map((n) => n.textContent?.trim());
    expect(numbers).toEqual(['1', '2', '3']);
    const ids = Array.from(el.querySelectorAll('[data-agenda-id]')).map((card) => card.getAttribute('data-agenda-id'));
    expect(ids).toEqual(['c', 'a', 'b']);
  });

  it('ignores impossible moves', () => {
    const { component, emitted } = setup();
    component.move(0, 0);
    component.move(-1, 1);
    component.move(0, 9);
    expect(emitted.length).toBe(0);
  });

  it('moves with the arrow keys on the handle', () => {
    const { component, emitted } = setup();
    const down = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true });
    component.onHandleKeydown(down, 'a');
    expect(down.defaultPrevented).toBe(true);
    expect(emitted.at(-1)?.map((i) => i.id)).toEqual(['b', 'a', 'c']);
    component.onHandleKeydown(new KeyboardEvent('keydown', { key: 'ArrowUp' }), 'c');
    expect(emitted.at(-1)?.map((i) => i.id)).toEqual(['b', 'c', 'a']);
    const before = emitted.length;
    component.onHandleKeydown(new KeyboardEvent('keydown', { key: 'Enter' }), 'a');
    expect(emitted.length).toBe(before);
  });

  it('announces the move for screen readers', () => {
    const { component } = setup();
    component.move(0, 2);
    expect(component.liveMessage()).toBe('Punto movido a la posición 3 de 3.');
  });

  it('adds a point below and never removes the last one', () => {
    const { component, emitted } = setup([items[1]]);
    component.addItem();
    expect(emitted.at(-1)?.length).toBe(2);
    component.removeItem('b');
    expect(emitted.at(-1)?.map((i) => i.title)).toEqual(['']);
    component.removeItem(emitted.at(-1)![0].id);
    expect(emitted.length).toBe(2); // el último punto no se elimina
  });

  it('marks untitled points as invalid only when errors are shown', () => {
    const { fixture, el } = setup([{ id: 'x', title: '' }]);
    expect(el.querySelector('input[data-title-for]')?.getAttribute('aria-invalid')).toBeNull();
    fixture.componentRef.setInput('showErrors', true);
    fixture.detectChanges();
    expect(el.querySelector('input[data-title-for]')?.getAttribute('aria-invalid')).toBe('true');
  });

  it('keeps the vote editing behavior', () => {
    const { component, emitted } = setup([{ id: 'x', title: 'P', hasVote: false }]);
    component.toggleVote('x', true);
    expect(emitted.at(-1)?.[0].voteTemplate?.questions.length).toBe(1);
    component.updateQuestionTitle('x', 0, '¿Sí?');
    component.addOption('x', 0);
    expect(emitted.at(-1)?.[0].voteTemplate?.questions[0]).toMatchObject({ title: '¿Sí?', options: ['', '', ''] });
    component.updateQuestionType('x', 0, 'text');
    expect(emitted.at(-1)?.[0].voteTemplate?.questions[0].options).toBeUndefined();
  });
});

describe('AgendaBuilderComponent majority type', () => {
  const question = (component: AgendaBuilderComponent, id: string) => component.items.find((i) => i.id === id)!.voteTemplate!.questions[0];

  it('asks for the majority type of each voted question, simple majority by default', () => {
    const { component, el, emitted } = setup([{ id: 'x', title: 'P', hasVote: false }]);
    component.toggleVote('x', true);
    expect(question(component, 'x').majorityType).toBe('mayoriaSimple');
    expect(emitted.at(-1)?.[0].voteTemplate?.questions[0].majorityType).toBe('mayoriaSimple');
    component.updateQuestionMajority('x', 0, 'tresQuintos');
    expect(question(component, 'x').majorityType).toBe('tresQuintos');
    expect(el).toBeTruthy();
  });

  it('shows the majority select with its three options under each question', () => {
    const { el } = setup();
    const select = el.querySelector('.vote-majority select') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent?.trim())).toEqual(['Mayoría simple', 'Tres quintas partes (3/5)', 'Unanimidad']);
    expect(el.querySelector('.vote-majority__legend')?.textContent).toContain('>50%');
  });

  it('drops the majority for free-text questions and restores it for choice questions', () => {
    const { component } = setup();
    component.updateQuestionType('a', 0, 'text');
    expect(question(component, 'a').majorityType).toBeUndefined();
    component.updateQuestionType('a', 0, 'multiple_choice');
    expect(question(component, 'a').majorityType).toBe('mayoriaSimple');
  });

  it('folds and unfolds a point and a question with their chevrons', () => {
    const { fixture, el } = setup([
      { id: 'f', title: 'Cuentas', hasVote: true, voteTemplate: { questions: [{ title: '¿Aprueba?', type: 'single_choice', options: ['Sí', 'No'], majorityType: 'mayoriaSimple' }] } },
    ]);
    const click = (label: string) => {
      (el.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement).click();
      fixture.detectChanges();
    };
    expect(el.querySelector('.vote-majority')).not.toBeNull();
    click('Plegar pregunta 1');
    expect(el.querySelector('.vote-majority')).toBeNull();
    expect(el.querySelector('[aria-label="Pregunta 1 del punto 1"]')).not.toBeNull();
    click('Desplegar pregunta 1');
    expect(el.querySelector('.vote-majority')).not.toBeNull();
    click('Plegar punto 1');
    expect(el.querySelector('.agenda-card__body')).toBeNull();
    expect(el.querySelector('[aria-label="Título del punto 1"]')).not.toBeNull();
    click('Desplegar punto 1');
    expect(el.querySelector('.agenda-card__body')).not.toBeNull();
  });

  it('opens a color palette from the circle of an answer and colors that answer', () => {
    const { fixture, component, emitted, el } = setup();
    const dot = () => el.querySelector('.vote-option .color-dot') as HTMLButtonElement;
    expect(el.querySelector('.color-palette')).toBeNull();
    dot().click();
    fixture.detectChanges();
    const swatches = el.querySelectorAll<HTMLButtonElement>('.color-palette .color-swatch');
    expect(swatches.length).toBe(9);
    expect(el.querySelector('.color-reset')).toBeNull();
    const purple = Array.from(swatches).find((s) => s.getAttribute('aria-label') === 'Morado')!;
    purple.click();
    fixture.detectChanges();
    expect(emitted.at(-1)?.[0].voteTemplate?.questions[0].optionColors).toEqual(['#B79AE0', '']);
    expect(el.querySelector('.color-palette')).toBeNull();
    // La respuesta se ve ya con ese color, como la verá quien vote.
    expect((el.querySelector('.vote-option') as HTMLElement).style.getPropertyValue('--option-color')).toBe('#B79AE0');
    expect(component.hasCustomColor(component.items[0].voteTemplate!.questions[0], 0)).toBe(true);
  });

  it('resets a color to the default and keeps colors aligned when options are added or removed', () => {
    const { component } = setup();
    const q = () => component.items[0].voteTemplate!.questions[0];
    component.setOptionColor('a', 0, 1, '#E0594A');
    component.addOption('a', 0);
    expect(q().optionColors).toEqual(['', '#E0594A', '']);
    component.removeOption('a', 0, 0);
    expect(q().options).toEqual(['No', '']);
    expect(q().optionColors).toEqual(['#E0594A', '']);
    component.setOptionColor('a', 0, 0, '');
    expect(q().optionColors).toEqual(['', '']);
    expect(component.hasCustomColor(q(), 0)).toBe(false);
  });

  it('drops the colors of a question that becomes free text', () => {
    const { component } = setup();
    component.setOptionColor('a', 0, 0, '#3FA372');
    component.updateQuestionType('a', 0, 'text');
    expect(component.items[0].voteTemplate!.questions[0].optionColors).toBeUndefined();
  });

  it('shows a placeholder when an older meeting has no majority yet', () => {
    const { el } = setup([{ id: 'o', title: 'Viejo', hasVote: true, voteTemplate: { questions: [{ title: '¿Sí?', type: 'single_choice', options: ['Sí', 'No'] }] } }]);
    const select = el.querySelector('.vote-majority select') as HTMLSelectElement;
    expect(select.options[0].textContent).toContain('Selecciona');
  });
});
