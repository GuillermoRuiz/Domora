import { Module } from '@nestjs/common';
import {
  CatastroCatalogController,
  EstateCatastroController,
} from './catastro.controller';
import { CatastroClient } from './catastro.client';
import { CatastroFacadeService } from './catastro-facade.service';
import { EstateGeoService } from './estate-geo.service';
import { CatastroService } from './catastro.service';
import { EstateAccessModule } from '../estate-access/estate-access.module';

@Module({
  imports: [EstateAccessModule],
  controllers: [CatastroCatalogController, EstateCatastroController],
  providers: [
    CatastroClient,
    CatastroService,
    CatastroFacadeService,
    EstateGeoService,
  ],
  exports: [CatastroService, CatastroFacadeService, EstateGeoService],
})
export class CatastroModule {}
