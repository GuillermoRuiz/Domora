import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PrivacidadComponent } from './privacidad.component';

describe('PrivacidadComponent', () => {
  it('muestra el título y explica el rol de encargada/subencargada de Domora', () => {
    TestBed.configureTestingModule({ imports: [PrivacidadComponent], providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(PrivacidadComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('h1')?.textContent).toBe('Política de privacidad');
    expect(el.textContent).toContain('subencargada');
    expect(el.textContent).toContain('Jitsi');
    expect(el.textContent).toContain('AEPD');
  });

  it('declara que el mapa de la finca carga imágenes de OpenStreetMap y cómo se ubica la finca', () => {
    TestBed.configureTestingModule({ imports: [PrivacidadComponent], providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(PrivacidadComponent);
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent?.replace(/\s+/g, ' ') ?? '';
    expect(text).toContain('OpenStreetMap');
    expect(text).toContain('reciben la dirección IP de quien lo consulta');
    expect(text).toContain('nunca datos de personas');
  });
});
