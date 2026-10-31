import { Module } from '@nestjs/common';
import {
  EstateExternalOwnersController,
  ExternalOwnersController,
  PropertyExternalOwnersController,
} from './external-owners.controller';
import { ExternalOwnersService } from './external-owners.service';
import { EstateAccessModule } from '../estate-access/estate-access.module';

@Module({
  imports: [EstateAccessModule],
  controllers: [
    EstateExternalOwnersController,
    PropertyExternalOwnersController,
    ExternalOwnersController,
  ],
  providers: [ExternalOwnersService],
  exports: [ExternalOwnersService],
})
export class ExternalOwnersModule {}
