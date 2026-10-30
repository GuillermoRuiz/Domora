import { Module, Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { IssueWorkflowModule } from '../issue-workflow/issue-workflow.module';
import { OperationsService } from './operations.service';
import { IssuesQueryDto, MeetingsQueryDto } from './operations-query.dto';

@Controller('operations')
@Roles('B')
export class OperationsController {
  constructor(private readonly service: OperationsService) {}
  @Get('meetings') meetings(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: MeetingsQueryDto,
  ) {
    return this.service.meetings(user, query);
  }
  @Get('issues') issues(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: IssuesQueryDto,
  ) {
    return this.service.issues(user, query);
  }
}
@Module({
  imports: [IssueWorkflowModule],
  controllers: [OperationsController],
  providers: [OperationsService],
})
export class OperationsModule {}
