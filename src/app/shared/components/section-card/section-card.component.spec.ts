import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SectionCardComponent } from './section-card.component';

@Component({
  standalone: true,
  imports: [SectionCardComponent],
  template: `
    <app-section-card title="Próximos hitos" [actionLabel]="actionLabel()" [padded]="padded()" (action)="clicks.update(n => n + 1)">
      <button slot="tools" class="tool">Año 2026</button>
      <p class="content">contenido</p>
    </app-section-card>
  `,
})
class HostComponent {
  actionLabel = signal('Ver todos');
  padded = signal(true);
  clicks = signal(0);
}

describe('SectionCardComponent', () => {
  function setup() {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    return { fixture, host: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
  }

  it('pinta el título y proyecta el contenido y las herramientas de la cabecera', () => {
    const { el } = setup();
    expect(el.querySelector('.section-card__title')?.textContent?.trim()).toBe('Próximos hitos');
    expect(el.querySelector('.section-card__body .content')?.textContent).toContain('contenido');
    expect(el.querySelector('.section-card__tools .tool')).not.toBeNull();
  });

  it('el enlace de acción emite al pulsarlo', () => {
    const { fixture, host, el } = setup();
    (el.querySelector('.section-card__action') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(host.clicks()).toBe(1);
  });

  it('sin actionLabel no hay enlace', () => {
    const { fixture, host, el } = setup();
    host.actionLabel.set('');
    fixture.detectChanges();
    expect(el.querySelector('.section-card__action')).toBeNull();
  });

  it('padded=false quita el relleno del cuerpo', () => {
    const { fixture, host, el } = setup();
    expect(el.querySelector('.section-card__body')?.classList.contains('section-card__body--padded')).toBe(true);
    host.padded.set(false);
    fixture.detectChanges();
    expect(el.querySelector('.section-card__body')?.classList.contains('section-card__body--padded')).toBe(false);
  });
});
