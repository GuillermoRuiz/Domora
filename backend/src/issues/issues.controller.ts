import type { Response } from 'express';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ISSUE_SITUATION_FILTER_KEYS,
  isSituationFilter,
} from '../issue-workflow/issue-situation';
import { IssuesService } from './issues.service';
import { AgendaTaskResolutionService } from '../agenda-tasks/agenda-task-resolution.service';
import { ResolveAgendaTaskDto } from '../agenda-tasks/dto/misc.dto';
import { IssueInteractionsService } from './issue-interactions.service';
import {
  PreviewRequesterNoticeDto,
  RecordVisitOutcomeDto,
  RescheduleVisitDto,
  RegisterInteractionDto,
  SetResolutionRouteDto,
  UpdateInsuranceClaimDto,
} from './dto/register-interaction.dto';
import { AssignIssueProviderDto } from './dto/assign-issue-provider.dto';
import { SendIssueNotificationDto } from './dto/send-issue-notification.dto';
import { CreateIssueDto } from './dto/create-issue.dto';
import { SetIssueAssetDto } from './dto/set-issue-asset.dto';
import { UpdateIssueStatusDto } from './dto/update-issue-status.dto';
import { UpdateIssueBudgetDto } from './dto/update-issue-budget.dto';
import { AddIssueTimelineEntryDto } from './dto/add-issue-timeline-entry.dto';
import { RequestIssueInfoDto } from './dto/owner-issue.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { EstateScopeGuard } from '../estate-access/estate-scope.guard';

@Controller('estates/:estateId/issues')
export class EstateIssuesController {
  constructor(private readonly issuesService: IssuesService) {}

  @Get()
  @UseGuards(EstateScopeGuard)
  listByEstate(
    @Param('estateId') estateId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('assetId', new ParseUUIDPipe({ optional: true })) assetId?: string,
    @Query('situation') situation?: string,
  ) {
    if (situation !== undefined && !isSituationFilter(situation))
      throw new BadRequestException(
        `situation debe ser uno de: ${ISSUE_SITUATION_FILTER_KEYS.join(', ')}.`,
      );
    return this.issuesService.listByEstate(estateId, user, {
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      assetId,
      situation,
    });
  }

  // Reportar una incidencia: siempre de la comunidad (no de una vivienda). Lo puede hacer la gestión (en nombre de la comunidad) o un
  // miembro activo de la comunidad (rol C): el servicio comprueba la pertenencia en la base de datos.
  @Post()
  @UseGuards(EstateScopeGuard)
  create(
    @Param('estateId') estateId: string,
    @Body() dto: CreateIssueDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.issuesService.create(estateId, dto, user);
  }
}

@Controller('issues')
export class IssuesController {
  constructor(
    private readonly issuesService: IssuesService,
    private readonly interactions: IssueInteractionsService,
    private readonly taskResolution: AgendaTaskResolutionService,
  ) {}

  @Get(':id')
  findById(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.issuesService.findById(id, user);
  }

  // La asignación de proveedores y los avisos enviados son de la gestión: el propietario no los lee.
  @Get(':id/provider')
  @Roles('A', 'B')
  currentProvider(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.issuesService.currentProvider(id, user);
  }

  @Get(':id/provider/history')
  @Roles('A', 'B')
  listProviderHistory(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.issuesService.listProviderHistory(id, user);
  }

  // Asignar proveedor y notificar a vecinos son acciones del lado gestor.
  @Post(':id/provider')
  @Roles('A', 'B')
  assignProvider(
    @Param('id') id: string,
    @Body() dto: AssignIssueProviderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.issuesService.assignProvider(id, dto, user);
  }

  @Get(':id/notifications')
  @Roles('A', 'B')
  listNotifications(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.issuesService.listNotifications(id, user);
  }

  @Post(':id/notifications')
  @Roles('A', 'B')
  sendNotification(
    @Param('id') id: string,
    @Body() dto: SendIssueNotificationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.issuesService.sendNotification(id, dto, user);
  }

  // Pedir información, cambiar estado y gestionar presupuesto son del lado
  // gestor — el servicio también lo valida (defensa en profundidad).
  /** Ask the owner for information (the issue waits in «Pendiente de información»). */
  @Post(':id/request-info')
  @Roles('A', 'B')
  requestInfo(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RequestIssueInfoDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.issuesService.requestInfo(id, dto, user);
  }

  // Eliminar la incidencia (borrado lógico): lado gestor.
  @Delete(':id')
  @Roles('A', 'B')
  deleteIssue(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.issuesService.deleteIssue(id, user);
  }

  @Patch(':id/status')
  @Roles('A', 'B')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateIssueStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.issuesService.updateStatus(id, dto, user);
  }

  // Vincular (o quitar) la instalación a la que se refiere: lado gestor.
  @Patch(':id/asset')
  @Roles('A', 'B')
  setAsset(
    @Param('id') id: string,
    @Body() dto: SetIssueAssetDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.issuesService.setAsset(id, dto, user);
  }

  @Patch(':id/budget')
  @Roles('A', 'B')
  updateBudget(
    @Param('id') id: string,
    @Body() dto: UpdateIssueBudgetDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.issuesService.updateBudget(id, dto, user);
  }

  // Registrar una comunicación externa o manual (llamada, WhatsApp, email…) y sus consecuencias: lado gestor.
  // Los efectos son una lista cerrada con esquema estricto; el servidor valida cada uno contra el estado actual.
  @Post(':id/interactions')
  @Roles('A', 'B')
  registerInteraction(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RegisterInteractionDto,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-domora-legacy-client') legacyClient: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Contrato: toda gestión dice cómo sigue la incidencia (`nextStep`). `legacyNoNextStep` está DEPRECADO: solo lo admite una
    // integración que se identifica con `X-Domora-Legacy-Client`, y la respuesta lo avisa (`Deprecation`).
    if (dto.legacyNoNextStep && dto.nextStep === undefined)
      res.setHeader('Deprecation', 'true');
    return this.interactions.register(id, dto, user, {
      requireNextStep: true,
      legacyClient,
    });
  }

  // Texto exacto del aviso al solicitante, antes de enviarlo. No envía ni registra nada.
  @Post(':id/requester-notices/preview')
  @HttpCode(200)
  @Roles('A', 'B')
  previewRequesterNotice(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PreviewRequesterNoticeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.interactions.previewRequesterNotice(id, dto, user);
  }

  // Siniestros de seguro de la incidencia (etapa derivada, profesional enviado y espera a la aseguradora). Solo gestión.
  @Get(':id/insurance-claims')
  @Roles('A', 'B')
  listInsuranceClaims(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.interactions.listClaims(id, user);
  }

  // Corrección o cambio de estado de un siniestro fuera de una comunicación (misma operación que el efecto update_claim).
  @Patch(':id/insurance-claims/:claimId')
  @Roles('A', 'B')
  updateInsuranceClaim(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('claimId', ParseUUIDPipe) claimId: string,
    @Body() dto: UpdateInsuranceClaimDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.interactions.updateClaim(id, claimId, dto, user);
  }

  // Visitas de la incidencia (proveedor del directorio, profesional asignado, enviado por la aseguradora o solo con nombre).
  @Get(':id/visits')
  @Roles('A', 'B')
  listVisits(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.interactions.listVisits(id, user);
  }

  // El resultado de una visita planificada (se realizó / no se realizó o se canceló). No depende del panel del proveedor.
  @Patch(':id/visits/:visitId')
  @Roles('A', 'B')
  recordVisitOutcome(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('visitId', ParseUUIDPipe) visitId: string,
    @Body() dto: RecordVisitOutcomeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.interactions.recordVisitOutcome(id, visitId, dto, user);
  }

  // Nueva hora de una visita planificada (profesional del directorio, asignado, de la aseguradora o solo con nombre).
  @Patch(':id/visits/:visitId/reschedule')
  @Roles('A', 'B')
  rescheduleVisit(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('visitId', ParseUUIDPipe) visitId: string,
    @Body() dto: RescheduleVisitDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.interactions.rescheduleVisit(id, visitId, dto, user);
  }

  // La vía por la que se gestiona la incidencia la decide una persona (el modelo solo puede sugerirla).
  @Put(':id/resolution-route')
  @Roles('A', 'B')
  setResolutionRoute(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetResolutionRouteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.interactions.decideRoute(id, dto, user);
  }

  // Resolver una decisión de ESTA incidencia desde su ficha: el camino de soporte (rol A), que no tiene agenda. Misma lógica
  // central que `POST /agenda/:id/resolution`; la autorización es la de la incidencia.
  @Post(':id/tasks/:taskId/resolution')
  @Roles('A', 'B')
  async resolveTask(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() body: ResolveAgendaTaskDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.issuesService.assertIssueAccess(id, user);
    return this.taskResolution.resolveForIssue(id, taskId, body.result, user);
  }

  // Comentar en el hilo es para ambos lados del canal (gestora y
  // propietario reportante) — sin restricción de rol, el acceso a la
  // incidencia ya lo valida el servicio.
  @Post(':id/timeline')
  addTimelineEntry(
    @Param('id') id: string,
    @Body() dto: AddIssueTimelineEntryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.issuesService.addTimelineEntry(id, dto, user);
  }
}
