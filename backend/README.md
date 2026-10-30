<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

### PostgreSQL local para los tests (Windows)

Muchas specs (`*.integration.spec.ts`) usan PostgreSQL real; ejecútalas con `npx jest --runInBand`. En Windows `localhost`
se resuelve primero a `::1` y un PostgreSQL local que solo escucha en IPv4 tarda ~2 s en cada conexión nueva, lo que rompe las
transacciones concurrentes (P2028). Por eso Jest carga `test/jest-local-db.js`, que reescribe `@localhost` por `@127.0.0.1` en
`DATABASE_URL` **solo dentro del proceso de test**; no cambia `.env` ni el código de la aplicación. Para el resto (arrancar el
backend, Prisma CLI, `MIGRATION_TEST_ADMIN_URL`) usa `127.0.0.1` en tu `.env` local.


## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Troubleshooting

### Cientos de errores `Property 'x' does not exist on type 'PrismaClient'` al compilar

Causa: el cliente Prisma generado (`node_modules/.prisma/client`) está
obsoleto respecto a `prisma/schema.prisma` (42 modelos). Esto le ocurre en
particular a cualquier copia de trabajo cuyo `node_modules` provenga del
periodo en que estuvo commiteado en git (solo tenía los 4 modelos de la
Fase 0).

Solución:

```bash
rm -rf node_modules dist
npm ci        # el postinstall de @prisma/client regenera el cliente
npm run build # 0 errores
```

Desde ahora `npm run build` y `npm run start` ejecutan `prisma generate`
automáticamente (scripts `prebuild`/`prestart`), así que basta con
regenerar una vez.

### Windows: `prisma generate` falla con EPERM / queda un `query_engine-windows.dll.node.tmp*`

Si hay un backend en marcha (p. ej. `node dist/src/main.js` en el puerto **3000**), tiene cargada
`node_modules/.prisma/client/query_engine-windows.dll.node` y `prisma generate` no puede reemplazarla: falla con EPERM y deja un
`query_engine-windows.dll.node.tmpNNNN` y un cliente que puede no coincidir con `prisma/schema.prisma`.

Antes de `npm run build`, `npm run start` o `npx prisma generate`:

1. Para tu proceso del puerto 3000 (`netstat -ano | findstr :3000`, luego `Stop-Process -Id <PID>`; conserva su `.env`/variables para relanzarlo igual).
2. `npx prisma generate` y comprueba que ya no queda ningún `query_engine-windows.dll.node.tmp*` en `node_modules/.prisma/client`.
3. Relanza el backend.

Para validar sin tocar tu proceso, genera y prueba en una copia del backend (con su `node_modules`) y una base PostgreSQL aparte.

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
