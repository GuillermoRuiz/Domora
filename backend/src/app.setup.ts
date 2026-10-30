import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

/**
 * HTTP configuration shared by main.ts and the e2e tests, so the tests
 * exercise the same app production runs (prefix, body limits, helmet, CORS,
 * validation). The app must be created with `rawBody: true` (Stripe webhook).
 */
export function configureApp(app: NestExpressApplication): void {
  // En producción el tráfico entra por nginx y se reenvía por la red interna
  // (ver doc/deploy-azure.md). Sin esto, `req.ip` es la IP del proxy — la
  // misma para TODAS las peticiones — y LoginThrottleGuard, que compone su
  // clave con `${req.ip}|${email}`, deja de distinguir clientes: la
  // protección por IP desaparece y cualquiera puede bloquear la cuenta ajena
  // gastando los 5 intentos por minuto de ese email.
  //
  // El valor es el número de proxies de confianza delante de la API. Debe
  // coincidir con el despliegue real: pasarse de largo permitiría a un
  // cliente falsear su IP vía X-Forwarded-For.
  app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 1));

  app.setGlobalPrefix('api/v1');

  // Antes dependía del límite implícito de Express (100 kb, sin declarar en
  // ningún sitio). Además de no ser explícito, era demasiado bajo: la
  // importación de extracto bancario (movements/import-bank-extract) manda
  // el lote entero en un solo JSON, y un año de movimientos de una finca
  // grande supera esos 100 kb sin esfuerzo. 2 MB es explícito y sigue
  // acotado — el multipart (documentos, adjuntos) ya tiene su propio límite
  // en StorageService.MAX_SIZE_BYTES, esto no lo toca.
  app.useBodyParser('json', { limit: '2mb' });
  app.useBodyParser('urlencoded', { extended: true, limit: '2mb' });

  // Antes esto era un middleware a mano que ponía cuatro cabeceras. Se
  // justificaba en que "node_modules está trackeado en git", cosa que ya no
  // es cierta, así que se sustituye por helmet: cubre lo mismo y además
  // mantiene la lista al día.
  //
  // La CSP se desactiva aquí a propósito: esta aplicación solo sirve JSON, y
  // la CSP que importa es la de la SPA, que la emite nginx junto al HTML
  // (ver doc/deploy-azure.md). Declararla aquí daría una falsa sensación de
  // cobertura sobre documentos que este proceso no sirve.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
      // Explícito porque el valor por defecto de helmet es 'sameorigin', más
      // permisivo que el DENY que ya emitía el middleware anterior: aceptarlo
      // habría sido rebajar la protección al adoptar la librería.
      frameguard: { action: 'deny' },
      hsts:
        process.env.NODE_ENV === 'production'
          ? { maxAge: 31_536_000, includeSubDomains: true }
          : false,
    }),
  );
  // El frontend Angular corre en un origen distinto (ng serve, puerto 4200)
  // del backend (puerto 3000) — necesario para que el navegador permita las
  // peticiones de AuthService/interceptors (Fase 1).
  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? ['http://localhost:4200'],
    credentials: true,
    // Sin esto el navegador (frontend y API en orígenes distintos) no deja leer la cabecera.
    exposedHeaders: ['X-Agenda-Truncated'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
}
