import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { LeadsService } from './leads.service';
import { ClientsService } from './clients.service';
import { ConvertLeadDto, CreateFollowUpDto, CreateLeadDto, SetNextActionDto, UpdateLeadDto } from './dto/leads.dto';

/** Potential clients and their «seguimiento comercial» (odd/tasks/role-a-panel.md S13). Role A only. */
@Controller('leads')
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Get()
  @Roles('A')
  list() {
    return this.leads.list();
  }

  @Get(':id')
  @Roles('A')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.leads.get(id);
  }

  @Post()
  @Roles('A')
  create(@Body() dto: CreateLeadDto, @CurrentUser() user: AuthenticatedUser) {
    return this.leads.create(dto, user);
  }

  @Patch(':id')
  @Roles('A')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLeadDto, @CurrentUser() user: AuthenticatedUser) {
    return this.leads.update(id, dto, user);
  }

  @Post(':id/follow-ups')
  @Roles('A')
  addFollowUp(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateFollowUpDto, @CurrentUser() user: AuthenticatedUser) {
    return this.leads.addFollowUp(id, dto, user);
  }

  /** «Convertir en cliente»: creates the despacho and links it to the lead. */
  @Post(':id/convert')
  @Roles('A')
  convert(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ConvertLeadDto, @CurrentUser() user: AuthenticatedUser) {
    return this.leads.convert(id, dto, user);
  }
}

/** Commercial data of the despacho clients for the Clientes screen (S13). Role A only. */
@Controller('clients')
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Get('overview')
  @Roles('A')
  overview() {
    return this.clients.overview();
  }

  @Put(':administratorId/next-action')
  @Roles('A')
  setNextAction(@Param('administratorId', ParseUUIDPipe) administratorId: string, @Body() dto: SetNextActionDto) {
    return this.clients.setNextAction(administratorId, dto);
  }

  @Get(':administratorId/follow-ups')
  @Roles('A')
  followUps(@Param('administratorId', ParseUUIDPipe) administratorId: string) {
    return this.clients.followUps(administratorId);
  }

  @Post(':administratorId/follow-ups')
  @Roles('A')
  addFollowUp(
    @Param('administratorId', ParseUUIDPipe) administratorId: string,
    @Body() dto: CreateFollowUpDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.clients.addFollowUp(administratorId, dto, user);
  }
}
