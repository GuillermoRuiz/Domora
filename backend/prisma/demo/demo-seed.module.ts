import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AccountingModule } from '../../src/accounting/accounting.module';
import { AdhesionRequestsModule } from '../../src/adhesion-requests/adhesion-requests.module';
import { AdminsModule } from '../../src/admins/admins.module';
import { AuthModule } from '../../src/auth/auth.module';
import { validateEnv } from '../../src/config/env.validation';
import { DebtorsModule } from '../../src/debtors/debtors.module';
import { DirectMessagesModule } from '../../src/direct-messages/direct-messages.module';
import { GdprModule } from '../../src/gdpr/gdpr.module';
import { AmenitiesModule } from '../../src/amenities/amenities.module';
import { InspectionsModule } from '../../src/inspections/inspections.module';
import { MeetingsModule } from '../../src/meetings/meetings.module';
import { ResourcesModule } from '../../src/resources/resources.module';
import { EstatesModule } from '../../src/estates/estates.module';
import { ExternalOwnersModule } from '../../src/external-owners/external-owners.module';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PropertiesModule } from '../../src/properties/properties.module';
import { PropertyMembershipsModule } from '../../src/property-memberships/property-memberships.module';
import { SepaModule } from '../../src/sepa/sepa.module';
import { SuppliersModule } from '../../src/suppliers/suppliers.module';
import { UserRepresentationsModule } from '../../src/user-representations/user-representations.module';

/**
 * Módulo raíz del seed demo (design D1). Importa los módulos de dominio REALES
 * necesarios, NUNCA AppModule: sin ScheduleModule (cero crons), sin Throttler
 * ni guards globales. Las fases F1..F4 irán añadiendo aquí los módulos que
 * necesiten.
 *
 * `ignoreEnvFile`: el seed lee solo el entorno REAL del proceso (el mismo que
 * valida el guard); un `.env` de desarrollo no puede colar claves externas.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      validate: validateEnv,
    }),
    PrismaModule,
    AdminsModule,
    // F1 (personas y propiedades): servicios REALES de fincas, propiedades,
    // titulares externos, invitaciones, adhesiones, SEPA (mandatos, cifrado
    // de IBAN, cuentas bancarias vía LedgerModule) y AuthModule (el seed
    // comprueba al final que las cuentas demo hacen login con AuthService).
    EstatesModule,
    PropertiesModule,
    PropertyMembershipsModule,
    ExternalOwnersModule,
    AdhesionRequestsModule,
    UserRepresentationsModule,
    SepaModule,
    AuthModule,
    // Global: aporta AuditService (lo inyectan Debtors/Mandates, como en AppModule).
    GdprModule,
    // F2 (contabilidad, SEPA y proveedores): recibos, remesas, cobros y
    // facturas de proveedor, todo vía servicios REALES. DebtorsModule aporta
    // la devolución de líneas de remesa (caso moroso) con el mismo efecto
    // que tendría la gestora desde la pantalla de morosos.
    AccountingModule,
    // F4 (cartera): los mensajes de la bandeja del gestor, para su actividad reciente.
    DirectMessagesModule,
    SuppliersModule,
    DebtorsModule,
    // F2b (instalaciones): activos e inspecciones vía AssetsService/InspectionsService.
    InspectionsModule,
    // F3 (panel del propietario): zonas comunes y reservas, documentos y juntas vía servicios REALES.
    AmenitiesModule,
    ResourcesModule,
    MeetingsModule,
  ],
})
export class DemoSeedModule {}
