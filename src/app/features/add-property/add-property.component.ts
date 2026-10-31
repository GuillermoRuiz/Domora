import { Component, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { StateService } from '../../core/state.service';
import { PropertiesService } from '../../core/properties.service';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { BtnComponent } from '../../shared/components/btn/btn.component';
import { MembershipRoleType, OwnerPropertyType, ViaType } from '../../core/models';

import { SelectDropdownDirective } from '../../shared/components/dropdown/select-dropdown.directive';
interface PropertyTypeOption {
  type: string;
  icon: string;
  label: string;
}

/**
 * Cómo se vincula una propiedad nueva del propietario. «Vincular a comunidad existente» (buscarla en el catálogo de
 * todas las fincas, GET /estates/search) está retirado: esa vinculación se replanteará con otra solución.
 */
type LinkMode = 'request' | 'later';

@Component({
  selector: 'app-add-property',
  standalone: true,
  imports: [FormsModule, IconComponent, BtnComponent, SelectDropdownDirective],
  templateUrl: './add-property.component.html',
  styleUrl: './add-property.component.scss'
})
export class AddPropertyComponent {
  state = inject(StateService);
  private properties = inject(PropertiesService);

  /**
   * Si el wizard se abrió desde el detalle de una finca (rol B/A), este
   * contexto viene precargado en StateService antes de mostrar el modal.
   * Se lee una sola vez al construir el componente porque el modal se
   * monta/desmonta con @if en app.html (constructor fresco cada apertura).
   */
  private readonly estateContext = this.state.addPropertyEstateContext();
  isEstateMode = computed(() => !!this.estateContext);

  step = signal(1);

  selectedType = signal('');
  viaType = signal<ViaType>('Calle');
  street = signal(this.estateContext?.address ?? '');
  number = signal(this.estateContext?.streetNumber ?? '');
  city = signal(this.estateContext?.location ?? '');
  province = signal('');
  floor = signal('');
  door = signal('');
  staircase = signal('');
  roleType = signal('');

  // Step 3 (rol C) — vinculación a comunidad
  linkMode = signal<LinkMode>('request');
  reqCommunityName = signal('');
  reqCommunityAddress = signal('');
  reqAdminName = signal('');
  reqAdminEmail = signal('');

  // Step 3 (rol B/A, modo finca) — datos de administración
  quotaMonthly = signal<number | null>(null);
  /** Coeficiente de participación en la finca (%). Opcional: puede completarse después desde la edición de la propiedad. */
  participationQuota = signal<number | null>(null);
  /** Superficie construida (m²). Opcional, mismo criterio que el coeficiente. */
  builtAreaM2 = signal<number | null>(null);


  submitting = signal(false);
  submitError = signal<string | null>(null);

  typeOptions: PropertyTypeOption[] = [
    { type: 'Piso', icon: 'building', label: 'Piso' },
    { type: 'Casa', icon: 'home', label: 'Casa' },
    { type: 'Parking', icon: 'car', label: 'Plaza de garaje' },
    { type: 'Trastero', icon: 'package', label: 'Trastero' },
    { type: 'Local', icon: 'store', label: 'Local comercial' },
  ];

  roleOptions = ['Propietario', 'Inquilino', 'Representante', 'Otro'];
  viaTypeOptions: ViaType[] = ['Calle', 'Avenida', 'Plaza', 'Paseo', 'Camino', 'Carretera'];

  get needsCommunity(): boolean {
    return ['Piso', 'Parking', 'Trastero', 'Local'].includes(this.selectedType());
  }

  get hasFloorDoor(): boolean {
    return ['Piso', 'Local'].includes(this.selectedType());
  }

  get previewAddress(): string {
    const parts = [this.street(), this.number(), this.city(), this.province()].filter(Boolean);
    return parts.join(', ') || 'Dirección no especificada';
  }

  close(): void {
    this.state.showAddPropertyModal.set(false);
    this.state.addPropertyEstateContext.set(null);
    this.step.set(1);
    this.selectedType.set('');
    this.viaType.set('Calle');
    this.street.set('');
    this.number.set('');
    this.city.set('');
    this.province.set('');
    this.floor.set('');
    this.door.set('');
    this.staircase.set('');
    this.roleType.set('');
    this.linkMode.set('request');
    this.reqCommunityName.set('');
    this.reqCommunityAddress.set('');
    this.reqAdminName.set('');
    this.reqAdminEmail.set('');
    this.quotaMonthly.set(null);
    this.participationQuota.set(null);
    this.builtAreaM2.set(null);
    this.submitError.set(null);
  }

  next(): void {
    if (this.step() < 3) this.step.set(this.step() + 1);
  }

  back(): void {
    if (this.step() > 1) this.step.set(this.step() - 1);
  }

  get canSubmit(): boolean {
    if (this.isEstateMode()) return true; // solo cuota y coeficiente, ambos opcionales
    if (!this.needsCommunity) return true;
    if (this.linkMode() === 'request') return !!this.reqCommunityName().trim();
    return true;
  }

  async submit(): Promise<void> {
    if (!this.canSubmit || this.submitting()) return;
    this.submitting.set(true);
    this.submitError.set(null);

    try {
      if (this.estateContext) {
        await this.properties.createEstateProperty(this.estateContext.id, {
          type: this.selectedType() as OwnerPropertyType,
          viaType: this.viaType(),
          viaName: this.street(),
          streetNumber: this.number(),
          staircase: this.staircase() || undefined,
          floor: this.floor() || undefined,
          door: this.door() || undefined,
          municipality: this.city(),
          province: this.province() || undefined,
          quotaMonthly: this.quotaMonthly() ?? undefined,
          participationQuota: this.participationQuota() ?? undefined,
          builtAreaM2: this.builtAreaM2() ?? undefined,
        });
      } else {
        // El propietario no elige una finca: "request" (comunidad sin gestora todavía) abre un
        // EstateOnboardingRequest que revisa soporte (ningún rol C crea fincas sin supervisión) y "later" la deja
        // sin vincular.
        const property = await this.properties.createOwnerProperty({
          type: this.selectedType() as OwnerPropertyType,
          roleType: (this.roleType() || 'Propietario') as MembershipRoleType,
          viaType: this.viaType(),
          viaName: this.street(),
          streetNumber: this.number(),
          staircase: this.staircase() || undefined,
          floor: this.floor() || undefined,
          door: this.door() || undefined,
          municipality: this.city(),
          province: this.province() || undefined,
          country: 'ES',
        });

        if (this.needsCommunity && this.linkMode() === 'request') {
          await this.properties.createEstateOnboardingRequest({
            propertyId: property.id,
            communityName: this.reqCommunityName().trim(),
            communityAddress: this.reqCommunityAddress().trim() || undefined,
            adminName: this.reqAdminName().trim() || undefined,
            adminEmail: this.reqAdminEmail().trim() || undefined,
          });
        }
      }

      this.state.propertiesVersion.update((v) => v + 1);
      this.step.set(4);
    } catch {
      this.submitError.set('No se pudo guardar la propiedad. Inténtalo de nuevo.');
    } finally {
      this.submitting.set(false);
    }
  }
}
