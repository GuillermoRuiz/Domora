import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CookiesComponent } from './cookies.component';

describe('CookiesComponent', () => {
  it('declara honestamente que no se usan cookies', () => {
    TestBed.configureTestingModule({ imports: [CookiesComponent], providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(CookiesComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('h1')?.textContent).toBe('Política de cookies');
    expect(el.textContent).toContain('Domora no utiliza cookies');
    expect(el.textContent).toContain('localStorage');
  });
});
