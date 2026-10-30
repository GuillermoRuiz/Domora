#!/bin/sh
# Entrypoint del contenedor de la API: aplica las migraciones pendientes
# antes de arrancar (idempotente — `migrate deploy` no toca nada si ya
# están aplicadas) y luego arranca Nest.
set -e

echo "Applying database migrations..."
npx prisma migrate deploy

exec node dist/src/main.js
