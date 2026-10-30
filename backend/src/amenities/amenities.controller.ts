import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { AmenitiesService } from './amenities.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { CreateAmenityDto } from './dto/create-amenity.dto';
import { UpdateAmenityDto } from './dto/update-amenity.dto';
import { CreateAmenityBlackoutDto } from './dto/create-amenity-blackout.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { EstateScopeGuard } from '../estate-access/estate-scope.guard';

class CancelBookingDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

// Reservas de zonas comunes: accesibles al rol C (residente de la finca)
// además de A/B — a diferencia de los módulos de gestión interna. La
// gestión del catálogo (alta/edición/mantenimiento) sí queda restringida a
// A/B vía @Roles.
@Controller('estates/:estateId/amenities')
@UseGuards(EstateScopeGuard)
export class EstateAmenitiesController {
  constructor(private readonly amenitiesService: AmenitiesService) {}

  @Get()
  list(
    @Param('estateId') estateId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.amenitiesService.listByEstate(estateId, user);
  }

  @Post()
  @Roles('A', 'B')
  create(
    @Param('estateId') estateId: string,
    @Body() dto: CreateAmenityDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.amenitiesService.createAmenity(estateId, dto, user);
  }

  @Get('bookings')
  @Roles('A', 'B')
  listBookings(
    @Param('estateId') estateId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.amenitiesService.listBookingsForEstate(estateId, user);
  }
}

@Controller('amenities')
export class AmenitiesController {
  constructor(private readonly amenitiesService: AmenitiesService) {}

  @Get(':id/availability')
  availability(
    @Param('id') id: string,
    @Query('date') date: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.amenitiesService.availability(id, date, user);
  }

  @Patch(':id')
  @Roles('A', 'B')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateAmenityDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.amenitiesService.updateAmenity(id, dto, user);
  }

  // Sin @Roles: el propietario también puede ver por qué una fecha está
  // bloqueada (se muestra junto a la disponibilidad en su calendario).
  @Get(':id/blackouts')
  listBlackouts(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.amenitiesService.listBlackouts(id, user);
  }

  @Post(':id/blackouts')
  @Roles('A', 'B')
  createBlackout(
    @Param('id') id: string,
    @Body() dto: CreateAmenityBlackoutDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.amenitiesService.createBlackout(id, dto, user);
  }

  @Delete(':id/blackouts/:blackoutId')
  @Roles('A', 'B')
  deleteBlackout(
    @Param('id') id: string,
    @Param('blackoutId') blackoutId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.amenitiesService.deleteBlackout(id, blackoutId, user);
  }
}

@Controller('bookings')
export class BookingsController {
  constructor(private readonly amenitiesService: AmenitiesService) {}

  @Get()
  listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.amenitiesService.listMyBookings(user);
  }

  @Post()
  create(
    @Body() dto: CreateBookingDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.amenitiesService.createBooking(dto, user);
  }

  @Patch(':id/cancel')
  cancel(
    @Param('id') id: string,
    @Body() dto: CancelBookingDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.amenitiesService.cancelBooking(id, dto.reason, user);
  }
}
