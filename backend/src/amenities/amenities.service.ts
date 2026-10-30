import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { CreateBookingDto } from './dto/create-booking.dto';
import type { CreateAmenityDto } from './dto/create-amenity.dto';
import type { UpdateAmenityDto } from './dto/update-amenity.dto';
import { dbErrorText } from '../prisma/prisma-errors';
import type { CreateAmenityBlackoutDto } from './dto/create-amenity-blackout.dto';

function slotHour(slot: string): number {
  return Number(slot.split(':')[0]);
}

@Injectable()
export class AmenitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly estateAccess: EstateAccessService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Rol C solo ve instalaciones activas (lo que puede reservar); A/B ven
   * también las desactivadas para poder reactivarlas desde el panel de
   * administración.
   */
  async listByEstate(estateId: string, user: AuthenticatedUser) {
    this.estateAccess.assertAccess(estateId, user);
    const managerView = user.role === 'A' || user.role === 'B';
    return this.prisma.amenity.findMany({
      where: { estateId, ...(managerView ? {} : { active: true }) },
      orderBy: { name: 'asc' },
    });
  }

  async createAmenity(
    estateId: string,
    dto: CreateAmenityDto,
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    return this.prisma.amenity.create({ data: { ...dto, estateId } });
  }

  async updateAmenity(
    id: string,
    dto: UpdateAmenityDto,
    user: AuthenticatedUser,
  ) {
    await this.findAmenityOrThrow(id, user);
    return this.prisma.amenity.update({ where: { id }, data: { ...dto } });
  }

  private async findAmenityOrThrow(amenityId: string, user: AuthenticatedUser) {
    const amenity = await this.prisma.amenity.findFirst({
      where: { id: amenityId },
    });
    if (!amenity) {
      throw new NotFoundException(`Amenity ${amenityId} no encontrada.`);
    }
    this.estateAccess.assertAccess(amenity.estateId, user);
    return amenity;
  }

  /** Periodos de indisponibilidad por mantenimiento de una instalación. */
  async listBlackouts(amenityId: string, user: AuthenticatedUser) {
    await this.findAmenityOrThrow(amenityId, user);
    return this.prisma.amenityBlackout.findMany({
      where: { amenityId },
      orderBy: { startDate: 'asc' },
    });
  }

  async createBlackout(
    amenityId: string,
    dto: CreateAmenityBlackoutDto,
    user: AuthenticatedUser,
  ) {
    await this.findAmenityOrThrow(amenityId, user);
    return this.prisma.amenityBlackout.create({
      data: {
        amenityId,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        reason: dto.reason ?? null,
      },
    });
  }

  async deleteBlackout(
    amenityId: string,
    blackoutId: string,
    user: AuthenticatedUser,
  ) {
    await this.findAmenityOrThrow(amenityId, user);
    const blackout = await this.prisma.amenityBlackout.findFirst({
      where: { id: blackoutId, amenityId },
    });
    if (!blackout) {
      throw new NotFoundException(
        `Periodo de mantenimiento ${blackoutId} no encontrado.`,
      );
    }
    await this.prisma.amenityBlackout.delete({ where: { id: blackoutId } });
  }

  private findBlackoutForDate(amenityId: string, date: Date) {
    return this.prisma.amenityBlackout.findFirst({
      where: { amenityId, startDate: { lte: date }, endDate: { gte: date } },
    });
  }

  /** Slots ocupados ese día por reservas no canceladas (de cualquier usuario). */
  async availability(amenityId: string, date: string, user: AuthenticatedUser) {
    const amenity = await this.findAmenityOrThrow(amenityId, user);
    const [bookings, blackout] = await Promise.all([
      this.prisma.booking.findMany({
        where: {
          amenityId,
          date: new Date(date),
          status: { not: 'cancelled' },
        },
        select: { startSlot: true, endSlot: true },
      }),
      this.findBlackoutForDate(amenityId, new Date(date)),
    ]);
    const occupied = new Set<string>();
    for (const b of bookings) {
      for (let h = slotHour(b.startSlot); h < slotHour(b.endSlot); h++) {
        occupied.add(`${String(h).padStart(2, '0')}:00`);
      }
    }
    return {
      amenityId,
      date,
      slots: amenity.slots,
      occupied: [...occupied].sort(),
      blocked: !!blackout,
      blockedReason: blackout?.reason ?? undefined,
    };
  }

  /**
   * Alta de reserva. Las validaciones de negocio (slots del catálogo,
   * maxHours, capacity) se hacen aquí; el anti-solapamiento REAL lo
   * garantiza la exclusion constraint GiST de la base de datos
   * (excl_bookings_no_overlap) — dos peticiones concurrentes no pueden
   * colarse, y la violación se traduce a 409.
   */
  async createBooking(dto: CreateBookingDto, user: AuthenticatedUser) {
    const amenity = await this.findAmenityOrThrow(dto.amenityId, user);
    if (!amenity.active) {
      throw new BadRequestException(
        'Esta zona común no admite reservas actualmente.',
      );
    }

    const startHour = slotHour(dto.startSlot);
    const endHour = slotHour(dto.endSlot);
    if (endHour <= startHour) {
      throw new BadRequestException('endSlot debe ser posterior a startSlot.');
    }
    if (endHour - startHour > amenity.maxHours) {
      throw new BadRequestException(
        `La reserva excede el máximo de ${amenity.maxHours}h de esta zona.`,
      );
    }
    const guests = dto.guests ?? 1;
    if (guests > amenity.capacity) {
      throw new BadRequestException(
        `Aforo máximo: ${amenity.capacity} personas.`,
      );
    }
    // Todos los slots horarios reservados deben existir en el catálogo de
    // la amenity (los slots son horas de inicio; el último reservado es
    // endSlot - 1h).
    for (let h = startHour; h < endHour; h++) {
      const slot = `${String(h).padStart(2, '0')}:00`;
      if (!amenity.slots.includes(slot)) {
        throw new BadRequestException(
          `El slot ${slot} no está disponible en esta zona.`,
        );
      }
    }

    const blackout = await this.findBlackoutForDate(
      dto.amenityId,
      new Date(dto.date),
    );
    if (blackout) {
      throw new ConflictException(
        blackout.reason
          ? `Zona no disponible por mantenimiento: ${blackout.reason}`
          : 'Zona no disponible por mantenimiento en esa fecha.',
      );
    }

    try {
      return await this.prisma.booking.create({
        data: {
          amenityId: dto.amenityId,
          propertyId: dto.propertyId ?? null,
          userId: user.id,
          date: new Date(dto.date),
          startSlot: dto.startSlot,
          endSlot: dto.endSlot,
          status: 'confirmed',
          guests,
          notes: dto.notes ?? null,
        },
        include: { amenity: { select: { name: true } } },
      });
    } catch (error) {
      // 23P01 = exclusion_violation (excl_bookings_no_overlap)
      if (
        error instanceof Error &&
        dbErrorText(error).includes('excl_bookings_no_overlap')
      ) {
        throw new ConflictException(
          'Ya existe una reserva solapada en ese horario.',
        );
      }
      throw error;
    }
  }

  async listMyBookings(user: AuthenticatedUser) {
    return this.prisma.booking.findMany({
      where: { userId: user.id },
      include: { amenity: { select: { name: true, estateId: true } } },
      orderBy: [{ date: 'desc' }, { startSlot: 'desc' }],
    });
  }

  /** Próximas reservas (no canceladas) de todas las instalaciones de una finca — panel de administración. */
  async listBookingsForEstate(estateId: string, user: AuthenticatedUser) {
    this.estateAccess.assertAccess(estateId, user);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    return this.prisma.booking.findMany({
      where: {
        amenity: { estateId },
        status: { not: 'cancelled' },
        date: { gte: today },
      },
      include: {
        amenity: { select: { name: true } },
        property: { select: { type: true, ref: true } },
        user: { select: { fullName: true } },
      },
      orderBy: [{ date: 'asc' }, { startSlot: 'asc' }],
    });
  }

  /** Cancela una reserva: su dueño, o un rol A/B con acceso a la finca. */
  async cancelBooking(
    bookingId: string,
    reason: string | undefined,
    user: AuthenticatedUser,
  ) {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId },
      include: { amenity: { select: { estateId: true, name: true } } },
    });
    if (!booking) {
      throw new NotFoundException(`Reserva ${bookingId} no encontrada.`);
    }
    const isOwner = booking.userId === user.id;
    const isManager =
      user.role !== 'C' &&
      this.estateAccess.canAccess(booking.amenity.estateId, user);
    if (!isOwner && !isManager) {
      throw new ForbiddenException('No puedes cancelar esta reserva.');
    }
    if (booking.status === 'cancelled') {
      throw new ConflictException('Esta reserva ya está cancelada.');
    }
    const cancelled = await this.prisma.booking.update({
      where: { id: bookingId },
      data: {
        status: 'cancelled',
        cancelledAt: new Date(),
        cancellationReason: reason ?? null,
      },
    });

    // Solo avisa cuando la CANCELA la gestora — cancelarse uno mismo no
    // necesita aviso.
    if (isManager && !isOwner) {
      await this.notifications.notify({
        userIds: [booking.userId],
        category: 'booking',
        title: `Tu reserva de "${booking.amenity.name}" fue cancelada`,
        body: reason ?? null,
        link: booking.propertyId
          ? `/c/properties/${booking.propertyId}`
          : '/c/properties',
        estateId: booking.amenity.estateId,
        propertyId: booking.propertyId,
      });
    }

    return cancelled;
  }
}
