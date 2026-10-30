import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Global module: PrismaService is needed by virtually every domain module,
 * so it is registered once here instead of re-importing PrismaModule
 * everywhere.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
