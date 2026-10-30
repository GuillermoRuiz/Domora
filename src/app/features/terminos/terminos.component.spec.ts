import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TerminosComponent } from './terminos.component';

describe('TerminosComponent', () => {
  it('muestra el título y cubre facturación, perfiles y protección de datos', () => {
    TestBed.configureTestingModule({ imports: [TerminosComponent], providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(TerminosComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('h1')?.textContent).toBe('Términos y condiciones');
    expect(el.textContent).toContain('Stripe');
    expect(el.textContent).toContain('Propietarios y residentes');
  });
});
