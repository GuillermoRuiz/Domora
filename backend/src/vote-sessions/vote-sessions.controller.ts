import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { VoteSessionsService } from './vote-sessions.service';
import { OpenVoteSessionDto } from './dto/open-vote-session.dto';
import { CastVoteDto } from './dto/cast-vote.dto';
import { RegisterVoteDto } from './dto/register-vote.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

// Sin @Roles a nivel de controller: abrir/cerrar es A/B, votar es cualquier
// elegible — autorización fina en el servicio, mismo criterio que
// MeetingVoteDelegationsController.
@Controller('meetings/:meetingId/vote-sessions')
export class VoteSessionsController {
  constructor(private readonly voteSessions: VoteSessionsService) {}

  @Get()
  list(@Param('meetingId') meetingId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.voteSessions.list(meetingId, user);
  }

  @Post()
  open(
    @Param('meetingId') meetingId: string,
    @Body() dto: OpenVoteSessionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.voteSessions.open(meetingId, dto, user);
  }

  /** Propiedades con deuda vencida (art. 15.2 LPH), para que la gestora vea a quién no puede registrar voto (solo Rol A/B). */
  @Get('debts')
  listDebts(@Param('meetingId') meetingId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.voteSessions.listDebts(meetingId, user);
  }

  /** ¿Puede votar quien consulta por esa propiedad? Solo lo ve quien puede actuar por ella: la deuda no es pública. */
  @Get('voting-right')
  votingRight(
    @Param('meetingId') meetingId: string,
    @Query('propertyId') propertyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.voteSessions.getVotingRight(meetingId, propertyId, user);
  }

  /** Voto de cada propiedad en la sesión (solo Rol A/B). */
  @Get(':id/responses')
  listResponses(
    @Param('meetingId') meetingId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.voteSessions.listResponses(meetingId, id, user);
  }

  /** La gestora registra o cambia el voto de una propiedad presente o representada (solo Rol A/B, con la votación abierta). */
  @Post(':id/responses')
  registerVote(
    @Param('meetingId') meetingId: string,
    @Param('id') id: string,
    @Body() dto: RegisterVoteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.voteSessions.registerVote(meetingId, id, dto, user);
  }

  @Post(':id/vote')
  castVote(
    @Param('meetingId') meetingId: string,
    @Param('id') id: string,
    @Body() dto: CastVoteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.voteSessions.castVote(meetingId, id, dto, user);
  }

  @Patch(':id/close')
  close(
    @Param('meetingId') meetingId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.voteSessions.close(meetingId, id, user);
  }
}
