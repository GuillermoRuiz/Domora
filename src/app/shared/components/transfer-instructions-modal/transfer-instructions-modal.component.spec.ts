import { TestBed } from '@angular/core/testing';
import { registerLocaleData } from '@angular/common';
import localeEs from '@angular/common/locales/es';
import { TransferInstructionsModalComponent } from './transfer-instructions-modal.component';

registerLocaleData(localeEs);

describe('TransferInstructionsModalComponent', () => {
  function setup(inputs: Partial<Pick<TransferInstructionsModalComponent, 'iban' | 'estateName' | 'amount' | 'concept'>> = {}) {
    TestBed.configureTestingModule({ imports: [TransferInstructionsModalComponent] });
    const fixture = TestBed.createComponent(TransferInstructionsModalComponent);
    Object.assign(fixture.componentInstance, inputs);
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
  }

  it('formatea el importe como moneda EUR', () => {
    const { el } = setup({ amount: 123.5 });
    expect(el.textContent).toContain('123,50');
    expect(el.textContent).toContain('€');
  });

  it('sin concepto ni beneficiario, no pinta esas filas', () => {
    const { el } = setup({ amount: 10 });
    expect(el.textContent).not.toContain('Concepto');
    expect(el.textContent).not.toContain('Beneficiario');
  });

  it('con concepto y finca, los muestra', () => {
    const { el } = setup({ amount: 10, concept: 'Cuota marzo', estateName: 'Edificio Sol' });
    expect(el.textContent).toContain('Cuota marzo');
    expect(el.textContent).toContain('Edificio Sol');
  });

  describe('IBAN', () => {
    it('formatea el IBAN en grupos de 4 caracteres', () => {
      const { component } = setup({ iban: 'ES1234567890123456789012' });
      expect(component.formattedIban()).toBe('ES12 3456 7890 1234 5678 9012');
    });

    it('sin IBAN, muestra el aviso de "todavía no tiene IBAN" en vez de la caja de copiar', () => {
      const { el } = setup({ amount: 10, iban: null });
      expect(el.textContent).toContain('todavía no tiene un IBAN configurado');
      expect(el.querySelector('.iban-box__value')).toBeNull();
    });

    it('con IBAN, muestra la caja para copiarlo', () => {
      const { el } = setup({ amount: 10, iban: 'ES1234567890123456789012' });
      expect(el.querySelector('.iban-box__value')?.textContent?.trim()).toBe('ES12 3456 7890 1234 5678 9012');
    });

    it('copyIban usa el portapapeles y marca "copiado" durante 2 segundos', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      vi.useFakeTimers();
      try {
        const { component } = setup({ amount: 10, iban: 'ES1234567890123456789012' });

        const copyPromise = component.copyIban();
        await vi.advanceTimersByTimeAsync(0);
        await copyPromise;

        expect(writeText).toHaveBeenCalledWith('ES1234567890123456789012');
        expect(component.copied()).toBe(true);

        await vi.advanceTimersByTimeAsync(2000);
        expect(component.copied()).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it('sin IBAN, copyIban no intenta nada', async () => {
      const writeText = vi.fn();
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      const { component } = setup({ amount: 10, iban: null });

      await component.copyIban();

      expect(writeText).not.toHaveBeenCalled();
    });
  });

  describe('cierre', () => {
    it('el click en el fondo emite closed', () => {
      const { fixture, el } = setup({ amount: 10 });
      let closeCount = 0;
      fixture.componentInstance.closed.subscribe(() => closeCount++);

      (el.querySelector('.modal-backdrop') as HTMLElement).click();

      expect(closeCount).toBe(1);
    });

    it('el click DENTRO del modal no lo cierra (stopPropagation)', () => {
      const { fixture, el } = setup({ amount: 10 });
      let closeCount = 0;
      fixture.componentInstance.closed.subscribe(() => closeCount++);

      (el.querySelector('.modal') as HTMLElement).click();

      expect(closeCount).toBe(0);
    });

    it('el botón "Entendido" emite closed', () => {
      const { fixture, el } = setup({ amount: 10 });
      let closeCount = 0;
      fixture.componentInstance.closed.subscribe(() => closeCount++);

      const okBtn = Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('Entendido'))!;
      okBtn.click();

      expect(closeCount).toBe(1);
    });
  });
});
