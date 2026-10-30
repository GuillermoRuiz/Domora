import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { SelectDropdownDirective } from '../../../../../shared/components/dropdown/select-dropdown.directive';
import type { ConvocatoriaDocument, MeetingSignerRole } from '../../../../../core/models';
import { MeetingsService } from '../../../../../core/meetings.service';
import { ConfirmDialogService } from '../../../../../shared/components/confirm-dialog/confirm-dialog.service';
import { BtnComponent } from '../../../../../shared/components/btn/btn.component';
import { AttendeePickerComponent } from '../attendee-picker/attendee-picker.component';
import { FileDropzoneComponent } from '../file-dropzone/file-dropzone.component';
import { JuntaConvocatoriaEditorComponent } from '../junta-convocatoria-editor/junta-convocatoria-editor.component';
import { JuntaDraftStore } from '../junta-draft.store';

/** Paso 3 del wizard "Nueva junta": asistentes, videollamada, firma de la convocatoria y documentos. */
@Component({
  selector: 'app-junta-guests-step',
  standalone: true,
  imports: [FormsModule, IconComponent, BtnComponent, SelectDropdownDirective, AttendeePickerComponent, FileDropzoneComponent, JuntaConvocatoriaEditorComponent],
  templateUrl: './junta-guests-step.component.html',
  styleUrl: './junta-guests-step.component.scss',
})
export class JuntaGuestsStepComponent implements OnInit {
  readonly draft = inject(JuntaDraftStore);
  private readonly meetings = inject(MeetingsService);
  private readonly confirmDialog = inject(ConfirmDialogService);

  /** Los tres roles que acepta el backend (`signerRole`); el nombre es opcional para cualquiera. */
  readonly signerRoles: { value: MeetingSignerRole; label: string }[] = [
    { value: 'administrador', label: 'Administrador' },
    { value: 'presidente', label: 'Presidente' },
    { value: 'secretario', label: 'Secretario' },
  ];

  private readonly nameRequested = signal(false);
  /** El campo de nombre se revela bajo demanda, o ya visible si trae valor (p. ej. al volver al paso). */
  readonly signerNameVisible = computed(() => this.nameRequested() || this.draft.signerName().length > 0);

  showSignerName(): void {
    this.nameRequested.set(true);
  }

  ngOnInit(): void {
    // Al llegar a este paso la convocatoria ya está redactada con lo que se ha rellenado; si venía de antes y
    // los datos cambiaron sin que la gestora la hubiera tocado, se actualiza sola.
    if (this.draft.convocatoria() === null || (this.draft.convocatoriaStale() && !this.draft.convocatoriaEdited())) {
      void this.loadConvocatoria();
    }
  }

  /** Pide al servidor la convocatoria habitual con los datos actuales del borrador. */
  async loadConvocatoria(): Promise<void> {
    const payload = this.draft.convocatoriaPayload();
    const estateId = this.draft.estateId();
    if (!payload || !estateId || this.draft.convocatoriaLoading()) return;
    const key = this.draft.convocatoriaKey();
    this.draft.convocatoriaLoading.set(true);
    this.draft.convocatoriaError.set('');
    try {
      this.draft.setConvocatoria(await this.meetings.previewConvocatoria(estateId, payload), key);
    } catch {
      this.draft.convocatoriaError.set('No se pudo redactar la convocatoria. Puedes seguir: se generará con el texto habitual.');
    } finally {
      this.draft.convocatoriaLoading.set(false);
    }
  }

  /** «Volver a redactar»: descarta lo editado y parte otra vez de los datos de la junta. */
  async rewriteConvocatoria(): Promise<void> {
    if (
      this.draft.convocatoriaEdited() &&
      !(await this.confirmDialog.ask({
        title: '¿Volver a redactar la convocatoria?',
        message: 'Se perderán los cambios que hayas hecho en el texto y se redactará de nuevo con los datos de la junta.',
        confirmLabel: 'Volver a redactar',
        cancelLabel: 'Conservar mi texto',
        tone: 'danger',
      }))
    )
      return;
    await this.loadConvocatoria();
  }

  setConvocatoria(doc: ConvocatoriaDocument): void {
    this.draft.convocatoria.set(doc);
  }
}
