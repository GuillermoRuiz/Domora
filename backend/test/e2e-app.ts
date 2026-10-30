import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import type { AppRole } from '../src/auth/auth.types';

export const API = '/api/v1';

export interface E2eApp {
  app: INestApplication<App>;
  server: App;
  sign: (
    role: AppRole,
    userId: string,
    administratorId: string | null,
    estateIds: string[],
  ) => string;
}

/**
 * Boots the complete AppModule exactly like main.ts does (same rawBody
 * option and configureApp), so the e2e suites cover the global guards,
 * pipes and security headers production runs with.
 */
export async function createE2eApp(): Promise<E2eApp> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    rawBody: true,
  });
  configureApp(app);
  await app.init();
  const jwt = moduleRef.get(JwtService);
  return {
    app: app as unknown as INestApplication<App>,
    server: app.getHttpServer() as App,
    sign: (role, userId, administratorId, estateIds) =>
      jwt.sign({ sub: userId, role, estateIds, administratorId }),
  };
}

export const bearer = (token: string) => ({
  Authorization: `Bearer ${token}`,
});
