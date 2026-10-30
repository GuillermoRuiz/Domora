import { Module } from '@nestjs/common';
import { UserRepresentationsController } from './user-representations.controller';
import { UserRepresentationsService } from './user-representations.service';

@Module({
  controllers: [UserRepresentationsController],
  providers: [UserRepresentationsService],
  exports: [UserRepresentationsService],
})
export class UserRepresentationsModule {}
