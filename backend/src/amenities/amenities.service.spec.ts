import { AmenitiesService } from './amenities.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { AppRole, AuthenticatedUser } from '../auth/auth.types';

function user(role: AppRole, overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: 'user-1',
    role,
    estateIds: ['estate-1'],
    administratorId: role === 'B' ? 'admin-1' : null,
    ...overrides,
  };
}

const BOOKING = {
  id: 'booking-1',
  userId: 'resident-1',
  propertyId: 'prop-1',
  status: 'confirmed',
  amenity: { estateId: 'estate-1', name: 'Piscina' },
};

/**
 * AmenitiesService no tenía NI UN test antes de esta tarea — se cubre
 * específicamente el aviso que ID 22 agregó (notifyBookings), no se
 * reescribe cobertura exhaustiva de todo el módulo.
 */
describe('AmenitiesService.cancelBooking — avisos', () => {
  let bookingFindFirst: jest.Mock;
  let bookingUpdate: jest.Mock;
  let notify: jest.Mock;
  let service: AmenitiesService;

  beforeEach(() => {
    bookingFindFirst = jest.fn().mockResolvedValue(BOOKING);
    bookingUpdate = jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...BOOKING, ...data }));
    notify = jest.fn().mockResolvedValue(undefined);

    const prisma = {
      booking: { findFirst: bookingFindFirst, update: bookingUpdate },
    } as unknown as PrismaService;

    service = new AmenitiesService(
      prisma,
      new EstateAccessService(),
      { notify } as unknown as NotificationsService,
    );
  });

  it('la gestora cancela la reserva de un vecino: avisa al vecino', async () => {
    await service.cancelBooking('booking-1', 'Mantenimiento', user('B'));
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        userIds: ['resident-1'],
        category: 'booking',
        link: '/c/properties/prop-1?tab=reservas',
      }),
    );
  });

  it('el vecino cancela su propia reserva: no se avisa a sí mismo', async () => {
    await service.cancelBooking('booking-1', undefined, user('C', { id: 'resident-1' }));
    expect(notify).not.toHaveBeenCalled();
  });
});
