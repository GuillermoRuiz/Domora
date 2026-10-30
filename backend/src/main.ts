import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

async function bootstrap() {
  // `rawBody: true` expone `req.rawBody` en TODAS las rutas sin desactivar
  // el parseo JSON del resto de la API — lo necesita únicamente el webhook
  // de Stripe (BillingController.webhook), que verifica una firma HMAC
  // calculada sobre los bytes exactos recibidos; un JSON reserializado por
  // el body-parser normal no produce la misma firma.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  configureApp(app);

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
}
void bootstrap();
