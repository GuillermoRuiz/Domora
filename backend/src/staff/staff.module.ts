import { Module } from '@nestjs/common';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';
import { EstateAccessModule } from '../estate-access/estate-access.module';
import { FilesModule } from '../files/files.module';

@Module({
  imports: [EstateAccessModule, FilesModule],
  controllers: [StaffController],
  providers: [StaffService],
  exports: [StaffService],
})
export class StaffModule {}
