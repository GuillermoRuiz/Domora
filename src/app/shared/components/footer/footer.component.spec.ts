import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { FooterComponent } from './footer.component';

describe('FooterComponent', () => {
  function setup() {
    TestBed.configureTestingModule({ imports: [FooterComponent], providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(FooterComponent);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('enlaza las 4 páginas legales', () => {
    const { el } = setup();
    const hrefs = Array.from(el.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/privacidad', '/aviso-legal', '/cookies', '/terminos']);
  });
});
