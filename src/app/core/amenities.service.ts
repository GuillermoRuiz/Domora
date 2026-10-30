import { Injectable, inject } from '@angular/core';
import { ApiClientService } from './api-client.service';
import { d } from './api-shared';
import { Amenity, AmenityBlackout, AmenityAvailability, Booking } from './models';

/** Instalaciones comunes de una finca (piscina, salón, pista...) y sus reservas. */
@Injectable({ providedIn: 'root' })
export class AmenitiesService {
  private api = inject(ApiClientService);

  listAmenitiesByEstate(estateId: string): Promise<Amenity[]> {
    return this.api.get<Amenity[]>(`/estates/${estateId}/amenities`);
  }

  createAmenity(estateId: string, input: {
    name: string; icon?: string; color?: string; bg?: string; maxHours: number;
    slots: string[]; rules?: string; capacity: number; seasonal?: boolean; seasonLabel?: string;
  }): Promise<Amenity> {
    return this.api.post<Amenity>(`/estates/${estateId}/amenities`, input);
  }

  updateAmenity(amenityId: string, input: Partial<{
    name: string; icon: string; color: string; bg: string; maxHours: number;
    slots: string[]; rules: string; capacity: number; seasonal: boolean; seasonLabel: string; active: boolean;
  }>): Promise<Amenity> {
    return this.api.patch<Amenity>(`/amenities/${amenityId}`, input);
  }

  listAmenityBlackouts(amenityId: string): Promise<AmenityBlackout[]> {
    return this.api.get<AmenityBlackout[]>(`/amenities/${amenityId}/blackouts`);
  }

  createAmenityBlackout(amenityId: string, input: { startDate: string; endDate: string; reason?: string }): Promise<AmenityBlackout> {
    return this.api.post<AmenityBlackout>(`/amenities/${amenityId}/blackouts`, input);
  }

  async deleteAmenityBlackout(amenityId: string, blackoutId: string): Promise<void> {
    await this.api.delete(`/amenities/${amenityId}/blackouts/${blackoutId}`);
  }

  async listMyBookings(): Promise<Booking[]> {
    const rows = await this.api.get<any[]>('/bookings');
    return rows.map(b => ({ ...b, date: d(b.date) }));
  }

  /** Próximas reservas de todas las instalaciones de una finca — panel de administración (rol A/B). */
  async listBookingsForEstate(estateId: string): Promise<Booking[]> {
    const rows = await this.api.get<any[]>(`/estates/${estateId}/amenities/bookings`);
    return rows.map(b => ({
      ...b,
      date: d(b.date),
      amenityName: b.amenity?.name ?? b.amenityName,
      propertyLabel: b.property ? `${b.property.type} ${b.property.ref ?? ''}`.trim() : undefined,
      userName: b.user?.fullName,
    }));
  }

  createBooking(input: {
    amenityId: string; propertyId?: string; date: string;
    startSlot: string; endSlot: string; guests?: number; notes?: string;
  }): Promise<Booking> {
    return this.api.post<Booking>('/bookings', input);
  }

  amenityAvailability(amenityId: string, date: string): Promise<AmenityAvailability> {
    return this.api.get<AmenityAvailability>(`/amenities/${amenityId}/availability`, { date });
  }

  async cancelBooking(bookingId: string, reason?: string): Promise<void> {
    await this.api.patch(`/bookings/${bookingId}/cancel`, { reason });
  }
}
