import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ContractDialogDirective } from './dialog-behavior.directive';

@Component({
  standalone: true,
  imports: [ContractDialogDirective],
  template: `
    <button id="opener" type="button">Abrir</button>
    @if (open()) {
      <div class="dlg" appContractDialog (dismiss)="dismissed.update(n => n + 1)" tabindex="-1">
        <button id="close" type="button">Cerrar</button>
        <input id="first" />
      </div>
    }
  `,
})
class HostComponent {
  open = signal(false);
  dismissed = signal(0);
}

describe('ContractDialogDirective', () => {
  function mount() {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    document.body.appendChild(fixture.nativeElement);
    return fixture;
  }

  it('al abrirse lleva el foco al primer control y devuelve el foco a quien lo tenía al cerrarse', async () => {
    const fixture = mount();
    const opener = fixture.nativeElement.querySelector('#opener') as HTMLButtonElement;
    opener.focus();
    fixture.componentInstance.open.set(true);
    fixture.detectChanges();
    await Promise.resolve();
    expect(document.activeElement?.id).toBe('close');
    fixture.componentInstance.open.set(false);
    fixture.detectChanges();
    await Promise.resolve();
    expect(document.activeElement).toBe(opener);
    fixture.nativeElement.remove();
  });

  it('Escape lo cierra aunque el foco no esté dentro, y fuera del diálogo no hace nada', () => {
    const fixture = mount();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(fixture.componentInstance.dismissed()).toBe(0);
    fixture.componentInstance.open.set(true);
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('#opener') as HTMLButtonElement).focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(fixture.componentInstance.dismissed()).toBe(1);
    fixture.nativeElement.remove();
  });
});
