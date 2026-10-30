import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ArrayMaxSize,
  IsArray,
  IsISO8601,
  IsOptional,
  IsUUID,
} from 'class-validator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { EstateScopeGuard } from '../../estate-access/estate-scope.guard';
import {
  ReconciliationService,
  type UploadedStatementFile,
} from './reconciliation.service';

export class MatchDto {
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  entryIds!: string[];

  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  lineIds!: string[];
}

export class BankLedgerQuery {
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;
}

/** Tesorería de una cuenta bancaria: mayor, extracto y conciliación. Solo gestión. */
@Controller('estates/:estateId/bank-accounts/:bankAccountId')
@UseGuards(EstateScopeGuard)
@Roles('A', 'B')
export class BankReconciliationController {
  constructor(private readonly service: ReconciliationService) {}

  @Get('ledger')
  ledger(
    @Param('estateId') estateId: string,
    @Param('bankAccountId', ParseUUIDPipe) bankAccountId: string,
    @Query() query: BankLedgerQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.ledger(estateId, bankAccountId, query, user);
  }

  @Get('statement')
  statement(
    @Param('estateId') estateId: string,
    @Param('bankAccountId', ParseUUIDPipe) bankAccountId: string,
    @Query('pending') pending: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.statement(
      estateId,
      bankAccountId,
      { pending: pending === 'true' },
      user,
    );
  }

  /** Sube el extracto del banco (Norma 43 o CSV). */
  @Post('statements')
  @UseInterceptors(
    FileInterceptor('file', { defParamCharset: 'utf8', limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  importStatement(
    @Param('estateId') estateId: string,
    @Param('bankAccountId', ParseUUIDPipe) bankAccountId: string,
    @UploadedFile() file: UploadedStatementFile,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.importStatement(estateId, bankAccountId, file, user);
  }

  @Post('reconciliations')
  match(
    @Param('estateId') estateId: string,
    @Param('bankAccountId', ParseUUIDPipe) bankAccountId: string,
    @Body() dto: MatchDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.match(estateId, bankAccountId, dto, user);
  }

  @Post('reconciliations/auto')
  @HttpCode(200)
  autoMatch(
    @Param('estateId') estateId: string,
    @Param('bankAccountId', ParseUUIDPipe) bankAccountId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.autoMatch(estateId, bankAccountId, user);
  }
}

/** Deshacer una conciliación: solo gestión. */
@Controller('reconciliations')
@Roles('A', 'B')
export class ReconciliationController {
  constructor(private readonly service: ReconciliationService) {}

  @Delete(':id')
  unmatch(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.unmatch(id, user);
  }
}
