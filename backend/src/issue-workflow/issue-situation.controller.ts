import { isUUID } from 'class-validator';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { IssueSituationService } from './issue-situation.service';
import { IssueJourneyService } from './issue-journey.service';

class AddMilestoneDto {
  @IsString() @MaxLength(120) label!: string;
  @IsOptional() @IsString() @MaxLength(40) afterKey?: string;
  @IsOptional() @IsIn(['Abierta', 'EnReparacion', 'PendienteProveedor', 'PendienteInformacion', 'Resuelta', 'Cerrada']) linkedStatus?: string;
}
class UpdateMilestoneDto {
  @IsOptional() @IsString() @MaxLength(120) label?: string;
  @IsOptional() @IsBoolean() done?: boolean;
  @IsOptional() @IsNumber() @Min(-1_000_000) @Max(1_000_000) position?: number;
  @IsOptional() @IsIn(['Abierta', 'EnReparacion', 'PendienteProveedor', 'PendienteInformacion', 'Resuelta', 'Cerrada', null]) linkedStatus?: string | null;
}

/** Máximo de incidencias por petición de situaciones (una página de lista). */
const MAX_IDS = 200;

/**
 * Situación operativa y siguiente paso de las incidencias. Solo la gestión:
 * el propietario no ve ni la maquinaria de Domora ni el trabajo del administrador.
 */
@Controller()
@Roles('A', 'B')
export class IssueSituationController {
  constructor(
    private readonly situation: IssueSituationService,
    private readonly journey: IssueJourneyService,
  ) {}

  /** Recorrido de la incidencia: hitos de su vía, que se rellenan al cumplirse, y los que la gestión añade o edita. */
  @Get('issues/:id/journey')
  journeyOf(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.journey.forIssue(id, user);
  }

  @Post('issues/:id/journey/milestones')
  addMilestone(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddMilestoneDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.journey.add(id, user, dto);
  }

  @Patch('issues/:id/journey/milestones/:ref')
  updateMilestone(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('ref') ref: string,
    @Body() dto: UpdateMilestoneDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.journey.update(id, ref, user, dto);
  }

  @Delete('issues/:id/journey/milestones/:ref')
  removeMilestone(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('ref') ref: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.journey.remove(id, ref, user);
  }

  /** Detalle: situación, siguiente paso y, si hay trabajo humano pendiente, el aviso con su enlace a Tareas. */
  @Get('issues/:id/situation')
  forIssue(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.situation.forIssue(id, user);
  }

  /** Lista: situación de las incidencias de una página de UNA finca (`ids` separados por comas). */
  @Get('estates/:estateId/issues/situations')
  forIssues(
    @Param('estateId', ParseUUIDPipe) estateId: string,
    @Query('ids') ids: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const list = (ids ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter((id) => isUUID(id))
      .slice(0, MAX_IDS);
    return this.situation.forIssues(estateId, list, user);
  }

  /** Resumen operativo de las incidencias de una finca. */
  @Get('estates/:estateId/issues/situation-summary')
  estateSummary(
    @Param('estateId', ParseUUIDPipe) estateId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.situation.summary(user, estateId);
  }

  /** Lo mismo, de todas las fincas que ve el usuario. */
  @Get('issues/situations/summary')
  summary(@CurrentUser() user: AuthenticatedUser) {
    return this.situation.summary(user);
  }
}
