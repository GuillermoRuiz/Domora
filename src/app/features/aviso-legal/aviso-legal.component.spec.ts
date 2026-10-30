import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AvisoLegalComponent } from './aviso-legal.component';

describe('AvisoLegalComponent', () => {
  it('muestra el título y marca claramente los datos identificativos pendientes', () => {
    TestBed.configureTestingModule({ imports: [AvisoLegalComponent], providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(AvisoLegalComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('h1')?.textContent).toBe('Aviso legal');
    expect(el.textContent).toContain('Pendiente antes de publicar');
    expect(el.textContent).toContain('RAZÓN SOCIAL');
  });
});
