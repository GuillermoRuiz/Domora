import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { LegalLayoutComponent } from './legal-layout.component';

@Component({
  standalone: true,
  imports: [LegalLayoutComponent],
  template: `<app-legal-layout title="Política de Prueba" updatedAt="1 de enero de 2026">
    <p class="probe">Contenido proyectado</p>
  </app-legal-layout>`,
})
class HostComponent {}

describe('LegalLayoutComponent', () => {
  it('muestra el título, la fecha y proyecta el contenido', () => {
    TestBed.configureTestingModule({ imports: [HostComponent], providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('h1')?.textContent).toBe('Política de Prueba');
    expect(el.textContent).toContain('1 de enero de 2026');
    expect(el.querySelector('.probe')?.textContent).toBe('Contenido proyectado');
    expect(el.querySelector('app-footer')).not.toBeNull();
  });
});
