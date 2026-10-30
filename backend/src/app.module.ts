import { Module } from '@nestjs/common';
import { OperationsModule } from './operations/operations.module';
import { ConfigModule } from '@nestjs/config';
import { scheduleModules } from './config/schedule-modules';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { DocumentsModule } from './documents/documents.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import { SupportAccessModule } from './support-access/support-access.module';
import { SupportAccessGuard } from './support-access/support-access.guard';
import { SubscriptionStatusGuard } from './auth/guards/subscription-status.guard';
import { EstateAccessModule } from './estate-access/estate-access.module';
import { EstatesModule } from './estates/estates.module';
import { PropertiesModule } from './properties/properties.module';
import { PropertyMembershipsModule } from './property-memberships/property-memberships.module';
import { ExternalOwnersModule } from './external-owners/external-owners.module';
import { UserRepresentationsModule } from './user-representations/user-representations.module';
import { AdhesionRequestsModule } from './adhesion-requests/adhesion-requests.module';
import { DirectMessagesModule } from './direct-messages/direct-messages.module';
import { IssuesModule } from './issues/issues.module';
import { AccountingModule } from './accounting/accounting.module';
import { EstateDashboardModule } from './estate-dashboard/estate-dashboard.module';
import { ManagerOverviewModule } from './manager-overview/manager-overview.module';
import { LedgerModule } from './ledger/ledger.module';
import { SepaModule } from './sepa/sepa.module';
import { DebtorsModule } from './debtors/debtors.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { CostCentresModule } from './cost-centres/cost-centres.module';
import { FiscalYearsModule } from './fiscal-years/fiscal-years.module';
import { StaffModule } from './staff/staff.module';
import { AmenitiesModule } from './amenities/amenities.module';
import { MeetingsModule } from './meetings/meetings.module';
import { MeetingVoteDelegationsModule } from './meeting-vote-delegations/meeting-vote-delegations.module';
import { VoteSessionsModule } from './vote-sessions/vote-sessions.module';
import { TwoFactorModule } from './two-factor/two-factor.module';
import { InspectionsModule } from './inspections/inspections.module';
import { ResourcesModule } from './resources/resources.module';
import { AdminsModule } from './admins/admins.module';
import { PlatformMetricsModule } from './platform-metrics/platform-metrics.module';
import { UsageModule } from './usage/usage.module';
import { CompletenessModule } from './completeness/completeness.module';
import { AdminBillingModule } from './admin-billing/admin-billing.module';
import { ClientHealthModule } from './client-health/client-health.module';
import { LeadsModule } from './leads/leads.module';
import { BillingModule } from './billing/billing.module';
import { FilesModule } from './files/files.module';
import { GdprModule } from './gdpr/gdpr.module';
import { ImportsModule } from './imports/imports.module';
import { CatastroModule } from './catastro/catastro.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AiModule } from './ai/ai.module';
import { AssistantModule } from './assistant/assistant.module';
import { AgendaTasksModule } from './agenda-tasks/agenda-tasks.module';
import { validateEnv } from './config/env.validation';
import { ReportingModule } from './reporting/reporting.module';

@Module({
  imports: [
    OperationsModule,
    // `validate` corre antes que nada: en producción aborta el arranque si
    // falta algún secreto crítico, en vez de caer a valores por defecto.
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    // Habilita los @Cron del proyecto (hoy: purga de tokens caducados).
    // DEMO_MODE: sin ScheduleModule los @Cron son decoradores inertes (cero
    // jobs en el entorno demo). Sin DEMO_MODE, exactamente como siempre.
    ...scheduleModules(),
    // Rate limit global (M5): antes solo /auth/login tenía protección
    // (LoginThrottleGuard, 5/min por IP+email). El resto de la API no tenía
    // ningún tope de peticiones por IP. 300/min es generoso a propósito —no
    // es anti-fuerza-bruta (para eso ya está el guard de login), es el
    // límite general que evita que un cliente roto o un scraper machaque la
    // API sin que nada lo frene. In-memory, mismo criterio que el guard de
    // login (sin Redis en el stack); usa `req.ip`, que ya resuelve bien
    // gracias al `trust proxy` configurado en main.ts (A1).
    ThrottlerModule.forRoot([{ name: 'global', ttl: 60_000, limit: 300 }]),
    PrismaModule,
    DocumentsModule,
    AuthModule,
    EstateAccessModule,
    SupportAccessModule,
    EstatesModule,
    PropertiesModule,
    PropertyMembershipsModule,
    ExternalOwnersModule,
    UserRepresentationsModule,
    AdhesionRequestsModule,
    DirectMessagesModule,
    IssuesModule,
    AccountingModule,
    EstateDashboardModule,
    ManagerOverviewModule,
    LedgerModule,
    ReportingModule,
    SepaModule,
    DebtorsModule,
    SuppliersModule,
    CostCentresModule,
    FiscalYearsModule,
    StaffModule,
    AmenitiesModule,
    MeetingsModule,
    MeetingVoteDelegationsModule,
    VoteSessionsModule,
    TwoFactorModule,
    InspectionsModule,
    ResourcesModule,
    AdminsModule,
    PlatformMetricsModule,
    UsageModule,
    CompletenessModule,
    AdminBillingModule,
    ClientHealthModule,
    LeadsModule,
    BillingModule,
    FilesModule,
    GdprModule,
    ImportsModule,
    CatastroModule,
    NotificationsModule,
    AgendaTasksModule,
    AiModule,
    AssistantModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Global guards: every route requires a valid JWT unless decorated with
    // @Public() (e.g. /auth/login, /auth/refresh), and every route is open
    // to any authenticated role unless decorated with @Roles(...).
    // See doc/plan.md section 2.3.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    // Role A is read-only on tenant routes unless it works inside an explicit
    // support session of the target despacho; every role A access to client
    // data is audited (odd/tasks/role-a-panel.md S5). After RolesGuard so a
    // route A cannot reach is refused there first.
    { provide: APP_GUARD, useExisting: SupportAccessGuard },
    // Control de acceso por estado de suscripción (solo rol B) — ver su
    // propio comentario para el porqué del escalado Vencida/Bloqueada.
    { provide: APP_GUARD, useClass: SubscriptionStatusGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
