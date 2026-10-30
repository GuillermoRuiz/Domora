import { setupComponent, type ComponentHarness } from '../../../core/testing/component-harness';
import type { Document as AppDocument } from '../../../core/models';
import { CommunityDocumentsComponent } from './community-documents.component';

const doc = (id: string, overrides: Partial<AppDocument> = {}): AppDocument => ({
  id, title: 'Presupuesto 2027', type: 'Presupuesto', date: '2026-03-12', size: '12 KB', targetPropertyId: null, ...overrides,
});

describe('CommunityDocumentsComponent', () => {
  let h: ComponentHarness<CommunityDocumentsComponent>;

  function mount(documents: AppDocument[] | null, failed = false): void {
    h = setupComponent(CommunityDocumentsComponent);
    h.fixture.componentRef.setInput('documents', documents);
    h.fixture.componentRef.setInput('failed', failed);
    h.fixture.detectChanges();
  }
  const rows = () => Array.from(h.el.querySelectorAll('[data-document]'));
  const row = (id: string) => h.el.querySelector(`[data-document="${id}"]`) as HTMLElement;

  it('muestra título, tipo, tamaño y fecha de cada documento, en el orden recibido', () => {
    mount([doc('a'), doc('b', { title: 'Estatutos', type: 'Estatutos', size: '980 KB', date: '2025-01-12' })]);
    expect(rows().map(r => r.getAttribute('data-document'))).toEqual(['a', 'b']);
    expect(row('a').querySelector('.doc__title')?.textContent?.trim()).toBe('Presupuesto 2027');
    expect(row('a').querySelector('.doc__sub')?.textContent?.trim()).toBe('Presupuesto · 12 KB · 12 mar 2026');
    expect(row('b').querySelector('.doc__sub')?.textContent?.trim()).toBe('Estatutos · 980 KB · 12 ene 2025');
  });

  it('dice en qué carpeta de la biblioteca está cada documento', () => {
    mount([doc('a', { folderName: 'Contabilidad y presupuestos' }), doc('b', { folderName: null })]);
    expect(row('a').querySelector('.doc__sub')?.textContent?.trim()).toBe('Contabilidad y presupuestos · Presupuesto · 12 KB · 12 mar 2026');
    expect(row('b').querySelector('.doc__sub')?.textContent?.trim()).toBe('Presupuesto · 12 KB · 12 mar 2026');
  });

  it('un documento publicado hoy dice «Hoy»', () => {
    const today = new Date();
    const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    mount([doc('a', { date: day })]);
    expect(row('a').querySelector('.doc__sub')?.textContent).toContain('Hoy');
  });

  it('enseña solo los 4 más recientes y ofrece «Ver todos»', () => {
    mount(['a', 'b', 'c', 'd', 'e', 'f'].map(id => doc(id)));
    expect(rows()).toHaveLength(4);
    expect(h.el.querySelector('.section-card__action')?.textContent).toContain('Ver todos');
  });

  it('descargar avisa con el documento y su botón dice cuál es', () => {
    mount([doc('a', { title: 'Normas de convivencia' })]);
    const downloaded: AppDocument[] = [];
    h.component.download.subscribe(d => downloaded.push(d));
    const button = row('a').querySelector('[data-action="download"]') as HTMLButtonElement;
    expect(button.getAttribute('aria-label')).toBe('Descargar Normas de convivencia');
    button.click();
    expect(downloaded.map(d => d.id)).toEqual(['a']);
  });

  it('pulsar un documento avisa para abrirlo, sin descargarlo', () => {
    mount([doc('a', { title: 'Normas de convivencia' })]);
    const opened: AppDocument[] = [];
    const downloaded: AppDocument[] = [];
    h.component.open.subscribe(d => opened.push(d));
    h.component.download.subscribe(d => downloaded.push(d));
    const button = row('a').querySelector('[data-action="open"]') as HTMLButtonElement;
    expect(button.getAttribute('aria-label')).toBe('Ver Normas de convivencia');
    expect(button.textContent).toContain('Normas de convivencia');
    button.click();
    expect(opened.map(d => d.id)).toEqual(['a']);
    expect(downloaded).toEqual([]);
  });

  it('«Ver todos» avisa', () => {
    mount([doc('a')]);
    let n = 0;
    h.component.viewAll.subscribe(() => n++);
    (h.el.querySelector('.section-card__action') as HTMLButtonElement).click();
    expect(n).toBe(1);
  });

  it('sin documentos lo dice y no ofrece «Ver todos»', () => {
    mount([]);
    expect(h.el.querySelector('[data-empty]')?.textContent).toContain('todavía no ha publicado documentos');
    expect(h.el.querySelector('.section-card__action')).toBeNull();
  });

  it('mientras cargan lo dice', () => {
    mount(null);
    expect(h.el.textContent).toContain('Cargando…');
  });

  it('si falla la carga lo avisa', () => {
    mount(null, true);
    expect(h.el.querySelector('[role="alert"]')?.textContent).toContain('No se pudieron cargar los documentos');
  });
});
