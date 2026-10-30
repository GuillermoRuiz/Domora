import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { ConvocatoriaDocument } from '../../../../../core/models';

/**
 * Convocatoria de la junta como el papel que recibirá cada propietario: cada bloque de texto se edita en su
 * sitio. No guarda nada por sí misma: emite el documento completo cada vez que cambia algo.
 */
@Component({
  selector: 'app-junta-convocatoria-editor',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './junta-convocatoria-editor.component.html',
  styleUrl: './junta-convocatoria-editor.component.scss',
})
export class JuntaConvocatoriaEditorComponent {
  @Input({ required: true }) doc!: ConvocatoriaDocument;
  @Input() disabled = false;
  @Output() docChange = new EventEmitter<ConvocatoriaDocument>();

  patch(changes: Partial<ConvocatoriaDocument>): void {
    this.docChange.emit({ ...this.doc, ...changes });
  }

  patchHeader(changes: Partial<ConvocatoriaDocument['header']>): void {
    this.patch({ header: { ...this.doc.header, ...changes } });
  }

  patchAgendaLine(index: number, text: string): void {
    this.patch({ agenda: this.doc.agenda.map((line, i) => (i === index ? { ...line, text } : line)) });
  }

  /** La firma se edita como un texto con una línea por renglón. */
  signatureText(): string {
    return this.doc.signature.join('\n');
  }

  setSignature(value: string): void {
    this.patch({ signature: value.split('\n') });
  }

  setAuthorizationEnabled(enabled: boolean): void {
    this.patch({ authorization: { ...this.doc.authorization, enabled } });
  }

  setAuthorizationText(text: string): void {
    this.patch({ authorization: { ...this.doc.authorization, text } });
  }
}
