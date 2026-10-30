import { Component, EventEmitter, Output, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { SelectDropdownDirective } from '../../../../../shared/components/dropdown/select-dropdown.directive';
import type { MeetingConvokedBy } from '../../../../../core/models';
import { DatetimeFieldComponent } from '../../../../../shared/components/datetime-field/datetime-field.component';
import { JuntaDraftStore } from '../junta-draft.store';
import { buildMapEmbedUrl, capitalizeAddress } from '../map-address.util';

/** Paso 1 del wizard "Nueva junta": datos generales, convocatorias y lugar. */
@Component({
  selector: 'app-junta-details-step',
  standalone: true,
  imports: [FormsModule, IconComponent, SelectDropdownDirective, DatetimeFieldComponent],
  templateUrl: './junta-details-step.component.html',
  styleUrl: './junta-details-step.component.scss',
})
export class JuntaDetailsStepComponent {
  readonly draft = inject(JuntaDraftStore);
  /** El usuario elige la comunidad (solo cuando el modal se abre sin una decidida). */
  @Output() estateChosen = new EventEmitter<string>();
  private readonly sanitizer = inject(DomSanitizer);

  readonly convokedByOptions: { value: MeetingConvokedBy; label: string }[] = [
    { value: 'presidente', label: 'El presidente de la comunidad' },
    { value: 'cuotas25', label: '25% de las cuotas de participación' },
    { value: 'propietarios25', label: 'Una cuarta parte de los propietarios' },
    { value: 'mandatoJudicial', label: 'Por mandato judicial' },
  ];

  mapEmbedUrl(): SafeResourceUrl | null {
    const url = buildMapEmbedUrl(this.draft.fullAddress());
    return url ? this.sanitizer.bypassSecurityTrustResourceUrl(url) : null;
  }

  onStreetBlur(): void {
    this.draft.street.set(capitalizeAddress(this.draft.street()));
  }

  onCityBlur(): void {
    this.draft.city.set(capitalizeAddress(this.draft.city()));
  }

  toggleMap(): void {
    this.draft.showMap.set(!this.draft.showMap());
  }
}
