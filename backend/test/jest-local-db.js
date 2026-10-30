/**
 * Solo pruebas (Jest): en Windows `localhost` se resuelve primero a `::1` y el PostgreSQL local suele escuchar solo en IPv4.
 * Cada conexión NUEVA del pool de Prisma tarda entonces ~2 s en caer a `127.0.0.1` (medido: 2158 ms frente a 71 ms), de modo
 * que con peticiones concurrentes una transacción no llega a abrirse dentro de `maxWait` (P2028 -> 500).
 *
 * Aquí se reescribe el host de `DATABASE_URL` únicamente para el proceso de test. No toca `.env`, ni el código de producto, ni
 * ningún entorno que no sea de pruebas (se exige NODE_ENV=test y un host exactamente `localhost`).
 */
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

if ((process.env.NODE_ENV ?? 'test') === 'test') {
  let url = process.env.DATABASE_URL;
  if (!url) {
    try {
      const env = readFileSync(join(__dirname, '..', '.env'), 'utf8');
      url = /^DATABASE_URL=["']?([^"'\r\n]+)/m.exec(env)?.[1];
    } catch {
      /* sin .env: se usa lo que haya */
    }
  }
  if (url) process.env.DATABASE_URL = url.replace(/@localhost(?=[:/])/, '@127.0.0.1');
}
