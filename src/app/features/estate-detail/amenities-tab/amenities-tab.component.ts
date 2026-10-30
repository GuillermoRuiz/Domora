import { Component, EventEmitter, Input, OnInit, Output, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BadgeComponent } from '../../../shared/components/badge/badge.component';
import { BtnComponent } from '../../../shared/components/btn/btn.component';
import { PageActionDirective } from '../../../shared/components/page-action/page-action.directive';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { Amenity, AmenityBlackout, Booking } from '../../../core/models';
import { AmenitiesService } from '../../../core/amenities.service';

const AMENITY_HOUR_OPTIONS: string[] = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`);

/** Pares color/fondo curados para instalaciones — mismas variables del tema que ya usa el catálogo sembrado. */
const AMENITY_COLOR_OPTIONS: { color: string; bg: string }[] = [
  { color: 'var(--color-accent)', bg: 'var(--color-bg)' },
  { color: 'var(--color-secondary)', bg: 'var(--color-secondary-bg)' },
  { color: 'var(--color-warning)', bg: 'var(--color-warning-bg)' },
  { color: 'var(--color-error)', bg: 'var(--color-error-bg)' },
];

/**
 * Pestaña "Instalaciones" de la finca (rol B), extraída de `estate-detail`:
 * catálogo de instalaciones, periodos de mantenimiento y próximas reservas.
 * Se carga sola al montarse y avisa al padre del nº de instalaciones
 * (`countChange`) para el contador de la pestaña.
 */
@Component({
  selector: 'app-amenities-tab',
  standalone: true,
  imports: [PageActionDirective, BadgeComponent, BtnComponent, IconComponent, FormsModule],
  templateUrl: './amenities-tab.component.html',
  styleUrl: './amenities-tab.component.scss',
})
export class AmenitiesTabComponent implements OnInit {
  @Input({ required: true }) estateId!: string;
  @Output() countChange = new EventEmitter<number>();

  private amenitiesSvc = inject(AmenitiesService);

  toastMessage = signal<string | null>(null);

  amenities = signal<Amenity[]>([]);
  amenitiesLoaded = signal(false);
  estateBookings = signal<Booking[]>([]);
  expandedAmenityId = signal<string | null>(null);
  blackoutsByAmenity = signal<Record<string, AmenityBlackout[]>>({});
  amenityColorOptions = AMENITY_COLOR_OPTIONS;
  amenityHourOptions = AMENITY_HOUR_OPTIONS;

  showNuevaAmenidad = signal(false);
  editAmenityId = signal<string | null>(null);
  amName = signal('');
  amIcon = signal('');
  amColor = signal(AMENITY_COLOR_OPTIONS[0].color);
  amBg = signal(AMENITY_COLOR_OPTIONS[0].bg);
  amMaxHours = signal<number | null>(2);
  amSlots = signal<string[]>([]);
  amRules = signal('');
  amCapacity = signal<number | null>(4);
  amSeasonal = signal(false);
  amSeasonLabel = signal('');
  amSaving = signal(false);
  amErrors = signal<{ name?: boolean; maxHours?: boolean; capacity?: boolean; slots?: boolean }>({});

  showNuevoBloqueo = signal(false);
  blackoutAmenityId = signal<string | null>(null);
  bkStartDate = signal('');
  bkEndDate = signal('');
  bkReason = signal('');
  bkSaving = signal(false);
  bkErrors = signal<{ dates?: boolean }>({});

  constructor() {
    effect(() => this.countChange.emit(this.amenities().length));
  }

  async ngOnInit(): Promise<void> {
    await this.loadAmenitiesTab();
  }

  private showToast(msg: string): void {
    this.toastMessage.set(msg);
    setTimeout(() => this.toastMessage.set(null), 2500);
  }

  private async loadAmenitiesTab(): Promise<void> {
    try {
      const [amenities, bookings] = await Promise.all([
        this.amenitiesSvc.listAmenitiesByEstate(this.estateId),
        this.amenitiesSvc.listBookingsForEstate(this.estateId),
      ]);
      this.amenities.set(amenities);
      this.estateBookings.set(bookings);
      this.amenitiesLoaded.set(true);
    } catch (error) {
      console.error('Error cargando las instalaciones', error);
    }
  }

  openNuevaAmenidad(): void {
    this.editAmenityId.set(null);
    this.amName.set('');
    this.amIcon.set('');
    this.amColor.set(AMENITY_COLOR_OPTIONS[0].color);
    this.amBg.set(AMENITY_COLOR_OPTIONS[0].bg);
    this.amMaxHours.set(2);
    this.amSlots.set([]);
    this.amRules.set('');
    this.amCapacity.set(4);
    this.amSeasonal.set(false);
    this.amSeasonLabel.set('');
    this.amErrors.set({});
    this.showNuevaAmenidad.set(true);
  }

  openEditAmenidad(am: Amenity): void {
    this.editAmenityId.set(am.id);
    this.amName.set(am.name);
    this.amIcon.set(am.icon ?? '');
    this.amColor.set(am.color || AMENITY_COLOR_OPTIONS[0].color);
    this.amBg.set(am.bg || AMENITY_COLOR_OPTIONS[0].bg);
    this.amMaxHours.set(am.maxHours);
    this.amSlots.set([...am.slots]);
    this.amRules.set(am.rules ?? '');
    this.amCapacity.set(am.capacity);
    this.amSeasonal.set(am.seasonal ?? false);
    this.amSeasonLabel.set(am.seasonLabel ?? '');
    this.amErrors.set({});
    this.showNuevaAmenidad.set(true);
  }

  closeNuevaAmenidad(): void {
    this.showNuevaAmenidad.set(false);
  }

  toggleAmSlot(slot: string): void {
    const current = this.amSlots();
    this.amSlots.set(
      current.includes(slot) ? current.filter(s => s !== slot) : [...current, slot].sort(),
    );
  }

  async submitAmenidad(): Promise<void> {
    const name = this.amName().trim();
    const maxHours = this.amMaxHours();
    const capacity = this.amCapacity();
    const slots = this.amSlots();
    const errors: { name?: boolean; maxHours?: boolean; capacity?: boolean; slots?: boolean } = {};
    if (!name) errors.name = true;
    if (!maxHours || maxHours < 1) errors.maxHours = true;
    if (!capacity || capacity < 1) errors.capacity = true;
    if (slots.length === 0) errors.slots = true;
    if (Object.keys(errors).length > 0) {
      this.amErrors.set(errors);
      return;
    }
    this.amSaving.set(true);
    const payload = {
      name,
      icon: this.amIcon().trim() || undefined,
      color: this.amColor(),
      bg: this.amBg(),
      maxHours: maxHours!,
      slots,
      rules: this.amRules().trim() || undefined,
      capacity: capacity!,
      seasonal: this.amSeasonal(),
      seasonLabel: this.amSeasonal() ? this.amSeasonLabel().trim() || undefined : undefined,
    };
    try {
      const editId = this.editAmenityId();
      const saved = editId
        ? await this.amenitiesSvc.updateAmenity(editId, payload)
        : await this.amenitiesSvc.createAmenity(this.estateId, payload);
      this.amenities.set(
        editId
          ? this.amenities().map(a => a.id === editId ? saved : a)
          : [...this.amenities(), saved],
      );
      this.showNuevaAmenidad.set(false);
      this.showToast(editId ? 'Instalación actualizada correctamente' : 'Instalación creada correctamente');
    } catch (error) {
      console.error('Error guardando la instalación', error);
      this.showToast('No se pudo guardar la instalación');
    } finally {
      this.amSaving.set(false);
    }
  }

  async toggleAmenityActive(am: Amenity): Promise<void> {
    try {
      const updated = await this.amenitiesSvc.updateAmenity(am.id, { active: !am.active });
      this.amenities.set(this.amenities().map(a => a.id === am.id ? updated : a));
      this.showToast(updated.active ? 'Instalación reactivada' : 'Instalación desactivada');
    } catch (error) {
      console.error('Error cambiando el estado de la instalación', error);
    }
  }

  async toggleAmenityExpanded(amenityId: string): Promise<void> {
    if (this.expandedAmenityId() === amenityId) {
      this.expandedAmenityId.set(null);
      return;
    }
    this.expandedAmenityId.set(amenityId);
    if (this.blackoutsByAmenity()[amenityId]) return;
    try {
      const blackouts = await this.amenitiesSvc.listAmenityBlackouts(amenityId);
      this.blackoutsByAmenity.set({ ...this.blackoutsByAmenity(), [amenityId]: blackouts });
    } catch (error) {
      console.error('Error cargando los periodos de mantenimiento', error);
    }
  }

  blackoutsFor(amenityId: string): AmenityBlackout[] {
    return this.blackoutsByAmenity()[amenityId] ?? [];
  }

  openNuevoBloqueo(am: Amenity): void {
    this.blackoutAmenityId.set(am.id);
    this.bkStartDate.set('');
    this.bkEndDate.set('');
    this.bkReason.set('');
    this.bkErrors.set({});
    this.showNuevoBloqueo.set(true);
  }

  closeNuevoBloqueo(): void {
    this.showNuevoBloqueo.set(false);
  }

  async submitBloqueo(): Promise<void> {
    const amenityId = this.blackoutAmenityId();
    const start = this.bkStartDate();
    const end = this.bkEndDate();
    if (!amenityId || !start || !end || end < start) {
      this.bkErrors.set({ dates: true });
      return;
    }
    this.bkSaving.set(true);
    try {
      const blackout = await this.amenitiesSvc.createAmenityBlackout(amenityId, {
        startDate: start,
        endDate: end,
        reason: this.bkReason().trim() || undefined,
      });
      this.blackoutsByAmenity.set({
        ...this.blackoutsByAmenity(),
        [amenityId]: [...this.blackoutsFor(amenityId), blackout],
      });
      this.showNuevoBloqueo.set(false);
      this.showToast('Periodo de mantenimiento registrado');
    } catch (error) {
      console.error('Error creando el periodo de mantenimiento', error);
      this.showToast('No se pudo registrar el periodo de mantenimiento');
    } finally {
      this.bkSaving.set(false);
    }
  }

  async deleteBloqueo(amenityId: string, blackoutId: string): Promise<void> {
    if (!confirm('¿Eliminar este periodo de mantenimiento?')) return;
    try {
      await this.amenitiesSvc.deleteAmenityBlackout(amenityId, blackoutId);
      this.blackoutsByAmenity.set({
        ...this.blackoutsByAmenity(),
        [amenityId]: this.blackoutsFor(amenityId).filter(b => b.id !== blackoutId),
      });
      this.showToast('Periodo de mantenimiento eliminado');
    } catch (error) {
      console.error('Error eliminando el periodo de mantenimiento', error);
    }
  }

  async cancelEstateBooking(booking: Booking): Promise<void> {
    if (!confirm(`¿Cancelar la reserva de ${booking.amenityName}?`)) return;
    try {
      await this.amenitiesSvc.cancelBooking(booking.id, 'Cancelada por la administración');
      this.estateBookings.set(this.estateBookings().filter(b => b.id !== booking.id));
      this.showToast('Reserva cancelada');
    } catch (error) {
      console.error('Error cancelando la reserva', error);
    }
  }
}
