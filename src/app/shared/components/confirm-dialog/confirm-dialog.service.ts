import { ApplicationRef, EnvironmentInjector, Injectable, createComponent, inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { ConfirmDialogComponent, type ConfirmDialogOptions } from './confirm-dialog.component';

export type { ConfirmDialogOptions } from './confirm-dialog.component';

/**
 * Pide una confirmación con el aspecto de la aplicación (en lugar del `confirm()` del
 * navegador). Devuelve `true` si se confirma y `false` si se cancela, con Esc o pulsando fuera.
 *
 *   if (!(await this.confirmDialog.ask({ title: 'Cancelar junta', message: '…', tone: 'danger' }))) return;
 */
@Injectable({ providedIn: 'root' })
export class ConfirmDialogService {
  private readonly appRef = inject(ApplicationRef);
  private readonly injector = inject(EnvironmentInjector);
  private readonly document = inject(DOCUMENT);

  ask(options: ConfirmDialogOptions): Promise<boolean> {
    const previouslyFocused = this.document.activeElement as HTMLElement | null;
    return new Promise<boolean>((resolve) => {
      const ref = createComponent(ConfirmDialogComponent, { environmentInjector: this.injector });
      ref.setInput('options', options);
      let settled = false;
      const subscription = ref.instance.decided.subscribe((confirmed) => {
        if (settled) return;
        settled = true;
        subscription.unsubscribe();
        this.appRef.detachView(ref.hostView);
        ref.destroy();
        previouslyFocused?.focus?.();
        resolve(confirmed);
      });
      this.appRef.attachView(ref.hostView);
      this.document.body.appendChild(ref.location.nativeElement);
      ref.changeDetectorRef.detectChanges();
    });
  }
}
