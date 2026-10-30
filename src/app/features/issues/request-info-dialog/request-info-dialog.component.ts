import { Component, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BtnComponent } from '../../../shared/components/btn/btn.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';

/**
 * «Pedir información»: la gestión pregunta a quien reportó la incidencia. La incidencia queda en «Pendiente de información»
 * hasta que responde (y vuelve al estado en el que estaba). El diálogo solo recoge el texto: envía la pantalla.
 */
@Component({
  selector: 'app-request-info-dialog',
  standalone: true,
  imports: [FormsModule, BtnComponent, IconComponent],
  templateUrl: './request-info-dialog.component.html',
  styleUrl: './request-info-dialog.component.scss',
})
export class RequestInfoDialogComponent {
  /** Si la incidencia ya espera una respuesta, esta pregunta la sustituye (el estado al que vuelve no cambia). */
  readonly alreadyWaiting = input(false);
  readonly busy = input(false);
  readonly error = input('');
  readonly sent = output<string>();
  readonly closed = output<void>();

  readonly text = signal('');
  readonly invalid = signal(false);

  submit(): void {
    const text = this.text().trim();
    this.invalid.set(!text);
    if (text && !this.busy()) this.sent.emit(text);
  }
}
