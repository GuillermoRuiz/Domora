import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    seed: 'node dist/prisma/seed.js',
  },
  datasource: {
    // `prisma generate` (Docker build, CI) runs without a database; migrate and
    // seed do need one and fail with a clear connection error if it is missing.
    url: process.env['DATABASE_URL'] ?? '',
  },
});
