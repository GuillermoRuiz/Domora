import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { EstateGeneralService } from './estate-general.service';
import { SetKeyContactDto } from './dto/estate-general.dto';

@Controller('estates/:estateId')
@Roles('A', 'B')
export class EstateGeneralController {
  constructor(private readonly general: EstateGeneralService) {}

  @Get('general-overview')
  overview(
    @Param('estateId', ParseUUIDPipe) estateId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.general.overview(estateId, user);
  }

  @Put('key-contacts')
  setKeyContact(
    @Param('estateId', ParseUUIDPipe) estateId: string,
    @Body() dto: SetKeyContactDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.general.setKeyContact(estateId, dto, user);
  }
}
