export type Role = 'A' | 'B' | 'C';

// ── Users (persona física global) ──────────────────────────────────────────
//
// Identidad única en la plataforma. El `id` (UUID) es la PK invisible y nunca
// cambia; email y taxId (NIF/NIE/equivalente nacional) son restricciones
// UNIQUE — ninguno puede repetirse pero pueden cambiar a lo largo del tiempo.
//
// Email es siempre obligatorio (es el identificador de login). taxId es
// obligatorio en cuanto el usuario tenga una membresía con
// `isPrimaryContact=true` de rol Propietario o Inquilino (regla de capa de
// aplicación, no constraint SQL — un usuario "ocupante" sin titularidad no
// necesita NIF, por ejemplo un menor de edad).

/** ISO 3166-1 alpha-2 — país emisor del tax ID. */
export type TaxIdCountry = 'ES' | 'PT' | 'FR' | 'DE' | 'IT' | 'AD' | 'NL' | 'BE' | 'OTHER';

export interface User {
  id: string;                       // UUID; PK invisible al usuario final
  email: string;                    // UNIQUE — identidad de login
  taxIdCountry: TaxIdCountry | null; // país del tax ID
  taxId: string | null;             // NIF/NIE/equivalente; UNIQUE con taxIdCountry
  fullName: string;
  phone?: string;
  language?: string;                // 'es', 'ca', 'pt'…
  timezone?: string;                // 'Europe/Madrid', etc.
  twoFaEnabled?: boolean;
  createdAt: string;
  updatedAt?: string;
  deletedAt?: string | null;        // soft delete
}

// ── Property membership (N:M user ↔ property) ───────────────────────────
//
// Relación N:M entre usuarios y propiedades con metadatos del rol concreto y
// estado del vínculo. Una propiedad puede tener varios usuarios (matrimonio,
// propietario + inquilino, herederos…) y un usuario puede estar vinculado a
// varias propiedades.

export type MembershipRoleType = 'Propietario' | 'Inquilino' | 'Representante' | 'Ocupante' | 'Otro';
export type MembershipStatus = 'pending' | 'linked' | 'revoked';

/** Roles invitables a una propiedad ya vinculada — un cambio de `Propietario` es otra operación (fuera de alcance). */
export type InvitableMembershipRoleType = 'Inquilino' | 'Representante' | 'Ocupante';

export interface PropertyMembership {
  id: string;
  propertyId: string;                 // FK → Property.id
  userId: string;                     // FK → User.id
  roleType: MembershipRoleType;
  status: MembershipStatus;
  isPrimaryContact: boolean;          // titular para cobros, comunicaciones oficiales, mandato SEPA
  nickname?: string;                  // alias personal del usuario (p.ej. "Vivienda habitual")
  linkedAt: string;
  revokedAt?: string | null;
  approvedByUserId?: string | null;   // admin que aprobó la adhesión
  notes?: string;
  user?: User;                        // embebido por listMembershipsByProperty
}

/** Info pública de un `PropertyMembershipInvite` — la landing `/membership-invite/:token` la pinta antes de saber si hay sesión iniciada. */
export interface MembershipInviteInfo {
  roleType: InvitableMembershipRoleType | 'Propietario';
  propertyAddress: string | null;
  estateName: string | null;
}

/** Respuesta de crear/reenviar una invitación — el enlace y el QR se construyen en el backend (mismo enlace que va en el email). */
export interface CreatedMembershipInvite {
  inviteUrl: string;
  qrDataUrl: string;
}

/** Derivado en el backend al leer, nunca persistido. */
export type PendingMembershipInviteStatus = 'pending' | 'expiring_soon' | 'expired' | 'revoked';

export interface PendingMembershipInvite {
  id: string;
  /** Incluye `Propietario` cuando la invitó la gestora sobre un titular importado. */
  roleType: InvitableMembershipRoleType | 'Propietario';
  inviteeEmail: string;
  /** Solo en invitaciones de Propietario: el titular importado que pasará a ser usuario. */
  externalOwnerId?: string | null;
  status: PendingMembershipInviteStatus;
  expiresAt: string;
  lastSentAt: string | null;
  createdAt: string;
}

// ── User representation (representación legal) ──────────────────────────
//
// Modela cuando un usuario actúa en nombre de otro: herederos, tutelas,
// apoderamientos generales o específicos. Permite que la auditoría registre
// quién actuó realmente Y a nombre de quién, e impide cobrar/notificar a
// alguien sin poder vigente.
//
// Reglas:
//  - representativeUserId != representedUserId (CHECK)
//  - Solo activos si `validUntil` es null o > hoy.
//  - El alcance puede acotarse a una finca o propiedad concretas
//    (granted{Estate,Property}Id) o ser global (ambos null).

export type RepresentationType =
  | 'tutela'                  // tutela legal de menor o incapacitado
  | 'curatela'                // curatela parcial
  | 'apoderamiento_general'   // poder notarial general
  | 'apoderamiento_especifico' // poder notarial específico
  | 'herencia_yacente'        // herencia pendiente de aceptar
  | 'representacion_legal';   // otro supuesto de representación

export interface UserRepresentation {
  id: string;
  representativeUserId: string;        // FK → User.id — quien actúa
  representedUserId: string;           // FK → User.id — en nombre de quién
  type: RepresentationType;
  scope?: string;                      // descripción libre del alcance
  documentRef?: string;                // referencia al documento legal (notarial, judicial)
  validFrom: string;
  validUntil?: string | null;          // null = indefinido
  grantedEstateId?: string | null;     // si está acotado a una finca
  grantedPropertyId?: string | null;   // si está acotado a una propiedad
  active: boolean;
  createdAt: string;
  createdByUserId?: string;
  revokedAt?: string | null;
  revokedByUserId?: string | null;
  revocationReason?: string;
}

// ── Property nickname per membership ───────────────────────────────────
// El alias se persiste a nivel de membresía: cada usuario vinculado a una
// propiedad puede llamarla a su manera ("Vivienda habitual" vs "Casa Madrid"
// para los miembros de un matrimonio que comparten piso).

// Añadimos aquí el campo opcional `nickname` a la membresía. Se aplica abajo
// extendiendo la interfaz definida más arriba — Property memberships ya
// existente.

// ── External owners (titulares no usuarios de la plataforma) ────────────
// El admin debe poder anotar al titular conocido de una propiedad aunque
// no sea usuario de la plataforma (caso típico: heredero pendiente, banco
// propietario por embargo, persona jurídica que no se da de alta). Estos
// datos sirven para emitir el recibo, dirigir el burofax o la notificación
// fiscal, pero NO dan acceso a la plataforma.
//
// Cuando esa persona se da finalmente de alta (firma alta como User), se
// crea la membresía real y el ExternalOwner queda marcado como "promovido"
// (relación 1:1 opcional `promotedToUserId`).

export interface ExternalOwner {
  id: string;
  propertyId: string;                  // FK → Property.id
  fullName: string;
  taxIdCountry?: TaxIdCountry;
  taxId?: string;
  email?: string;
  phone?: string;
  postalAddress?: string;              // dirección postal para burofaxes / cartas certificadas
  roleType?: MembershipRoleType;       // su rol respecto a la propiedad
  notes?: string;
  createdAt: string;
  createdByUserId: string;             // admin que registró el titular externo
  promotedToUserId?: string | null;    // se rellena cuando la persona se da de alta
  promotedAt?: string | null;
}

// ── Mandato SEPA (refactor del mandato como string) ─────────────────────
//
// El mandato SEPA del cobro está hoy embebido como string en RemesaCandidate
// y AccountingReceipt. Lo formalizamos para llevar la secuencia FRST/RCUR y
// el titular real.

// El mandato tiene su propio ciclo de vida y su propio esquema SEPA. Según
// el Rulebook EPC016-06 (SDD Core) / EPC131-08 (SDD B2B):
//   - active: firmado y utilizable.
//   - dormant: sin uso durante ≥ 36 meses → vencido automáticamente.
//     Requiere nueva firma antes de volver a cobrar.
//   - revoked: revocado explícitamente por el deudor o el acreedor.
//   - pending_signature: creado pero pendiente de firma.
//   - expired: caducado por norma (>= 36 meses de inactividad).
export type MandateStatus = 'active' | 'dormant' | 'revoked' | 'pending_signature' | 'expired';

// Esquemas SDD estándar. En Cuaderno 19.14 se generan ambos con el mismo
// pain.008.001.02 pero con secciones diferenciadas.
// (`SepaScheme` ya existente reutilizada.)

// Tipo de pago del mandato:
//   - recurrent: cobros periódicos (cuotas de comunidad, la mayoría).
//   - oneOff: mandato de uso único (derrama, cuota puntual) — genera OOFF.
export type MandatePaymentType = 'recurrent' | 'oneOff';

/**
 * Mandato SEPA formalizado.
 *
 * Cumple con los datos mínimos exigidos por el Rulebook EPC y el Reglamento
 * UE 260/2012:
 *  - UMR único por acreedor (`umr`, ≤35 chars).
 *  - Fecha de firma.
 *  - Datos del deudor (via titularUserId → snapshots).
 *  - IBAN + BIC opcional del deudor.
 *  - Esquema (CORE/B2B) — se fija al firmar.
 *  - Tipo de pago (recurrente / puntual).
 *  - Estado con distinción entre revoked (baja explícita), expired
 *    (vencimiento por 36 meses de inactividad) y dormant (aún reutilizable
 *    con nueva firma).
 *
 * Amendments (cambios post-firma) se registran en `mandate_amendments`.
 */
export interface Mandate {
  id: string;
  umr: string;                         // Unique Mandate Reference (≤35 chars, único por acreedor).
                                       // Sustituye al anterior `ref: 'MND-0012'`.
  creditorEstateId: string;            // FK → Estate.id — la COMUNIDAD es el acreedor SEPA.
  propertyId: string;
  titularUserId: string;               // FK → User.id
  scheme: SepaScheme;                  // CORE o B2B — fijado al firmar
  paymentType: MandatePaymentType;     // recurrent | oneOff
  debtorIban: string;
  debtorBic?: string | null;           // opcional en CORE post-2016; obligatorio en B2B
  signedAt: string;                    // fecha de firma (YYYY-MM-DD)
  firstUseAt?: string | null;          // null hasta el primer cobro → próxima seq = FRST
  lastUseAt?: string | null;           // para detectar la regla de 36 meses (mandato dormant→expired)
  revokedAt?: string | null;
  revokedReason?: string;
  status: MandateStatus;
}

/**
 * Cambios en un mandato tras la firma inicial.
 *
 * Según SEPA, cualquier cambio en el IBAN del deudor, en el BIC, en la
 * identificación del acreedor o en el propio UMR requiere marcar la
 * siguiente remesa con `AmdmntInd=true` y transportar los datos originales
 * en el bloque `OrgnlMndtId` / `OrgnlDbtrAcct` / etc. Esta tabla lleva ese
 * histórico.
 */
export type MandateAmendmentField =
  | 'debtor_iban' | 'debtor_bic' | 'debtor_name' | 'debtor_tax_id'
  | 'creditor_id' | 'umr';

export interface MandateAmendment {
  id: string;
  mandateId: string;
  field: MandateAmendmentField;
  oldValue: string;
  newValue: string;
  changedAt: string;
  changedByUserId: string;
  /**
   * Si es true, la próxima remesa que use este mandato debe transportar
   * el bloque original en el XML pain.008. Se pone a false una vez la
   * remesa con el AmdmntInd se ha generado.
   */
  pendingInFirstNextRemesa: boolean;
}

/**
 * Creditor Identifier SEPA (CID) — identificador único del acreedor.
 *
 * Formato oficial español:
 *   ES + 2 dígitos de control (ISO 7064 mod 97-10)
 *      + 3 caracteres código de negocio (ZZZ por defecto, personalizable)
 *      + NIF/CIF (9 caracteres)
 *   = 16 caracteres totales.
 *
 * Ejemplo válido: 'ES23ZZZG12345678'.
 *
 * En cuotas de comunidad, el acreedor SEPA es la COMUNIDAD DE PROPIETARIOS,
 * no la gestora. Cada `estate` tiene su propio CID emitido por su banco de
 * cobro. Vive en `Estate.creditorId`.
 */



export type PlanTier = 'BASE' | 'STANDARD' | 'PREMIUM';
export type AdminStatus = 'Activa' | 'Periodo de gracia' | 'Vencida' | 'Bloqueada';
/** How often the despacho is billed; `mrr` is always monthly (an annual Stripe price is stored divided by 12). */
export type BillingInterval = 'month' | 'year';
/** Mismo conjunto que Stripe.Subscription.Status — se muestra tal cual, sin traducir. */
export type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete' | 'incomplete_expired' | 'unpaid' | 'paused';

export interface PlanUserTier {
  max: number;
  price: number;
}

/** Fuente de verdad del catálogo de planes — GET /plans, ver backend/src/admins/plans.catalog.ts. */
export interface PlansCatalog {
  prices: Record<PlanTier, number>;
  tiers: Record<PlanTier, PlanUserTier[]>;
}

export interface AdminFinca {
  id: string;
  name: string;
  type: EstateType;
  location: string;
  units: number;
  since: string;
  active: boolean;
}

export type AdminInvoiceStatus = 'Pagada' | 'Pendiente' | 'Vencida';

/** Commercial status of a despacho as a Domora client (S6); derived by the API, never stored. */
export type ClientStatus = 'En prueba' | 'En onboarding' | 'Activo' | 'Suspendido' | 'Cancelado';
/** Payment situation of a despacho (S6), independent of its client status; derived by the API. */
export type PaymentStatus = 'Al día' | 'Pendiente' | 'Vencido' | 'Fallido';

/** Unpaid Domora invoices of a despacho; amounts in € with VAT (what the client owes). */
export interface PendingInvoicesSummary {
  /** Pendiente (in term) + Vencida. */
  count: number;
  amount: number;
  overdueCount: number;
  overdueAmount: number;
}

/** Signal of the salud index (S14); scores 0-100, 100 = healthy. */
export type HealthSignalKey = 'payment' | 'usage' | 'completeness' | 'support';

export interface HealthSignalBreakdown {
  key: HealthSignalKey;
  /** null when the signal cannot be judged yet (usage grace period, support not available). */
  score: number | null;
  weight: number;
  /** Points of salud this signal takes away. */
  deduction: number;
  available: boolean;
}

/** Signal that subtracts most from salud: «Pagos pendientes», «Uso muy bajo», «Baja adopción», «Onboarding incompleto», «Incidencias graves». */
export interface SaludMotivo {
  code: 'payment' | 'low_usage' | 'low_adoption' | 'completeness' | 'support';
  label: string;
}

/** Why Domora should act on a despacho (S7); severity 3 = act now, 2 = this week, 1 = follow up. */
export interface AttentionReason {
  code: 'overdue_payment' | 'serious_tickets' | 'low_activity' | 'onboarding_blocked';
  label: string;
  severity: number;
}

/** Salud of a despacho (`GET /client-health/offices`, `/offices/:id`, role A). */
export interface OfficeHealth {
  administratorId: string;
  name: string;
  plan: PlanTier;
  createdAt: string;
  clientStatus: ClientStatus;
  paymentStatus: PaymentStatus;
  completeness: number;
  /** 0-100; null for Cancelado despachos. */
  salud: number | null;
  /** «En riesgo»: a flag, never a client status. */
  atRisk: boolean;
  motivo: SaludMotivo | null;
  signals: HealthSignalBreakdown[];
  usage: { activeDays: number; activeUsers: number; staffUsers: number; observedDays: number };
  attention: AttentionReason[];
}

export interface ClientHealthOverview {
  /** «En riesgo» threshold in use. */
  atRiskBelow: number;
  /** KPI «Churn risk»: at-risk despachos that are paying (Activo / En onboarding). */
  churnRisk: number;
  offices: OfficeHealth[];
}

/** One row of «Requieren atención» (`GET /client-health/attention`, role A), most severe first. */
export interface AttentionItem {
  administratorId: string;
  name: string;
  plan: PlanTier;
  clientStatus: ClientStatus;
  paymentStatus: PaymentStatus;
  completeness: number;
  salud: number | null;
  atRisk: boolean;
  reasons: AttentionReason[];
}

// ── Clientes: leads and commercial follow-up (role A, S13) ───────────────
// Mirrors `Lead`, `CommercialFollowUp` and `ClientNextAction` in schema.prisma.

export type LeadOrigin = 'web' | 'referido' | 'comercial' | 'solicitud_alta';
export type LeadStatus = 'nuevo' | 'contactado' | 'en_prueba' | 'convertido' | 'descartado';

/** One «seguimiento comercial» entry of a lead or a despacho client. */
export interface CommercialFollowUp {
  id: string;
  occurredAt: string;
  text: string;
  author: string;
}

/** Potential client of Domora; becomes the Administrator when converted. */
export interface Lead {
  id: string;
  name: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  city: string | null;
  origin: LeadOrigin;
  planOfInterest: PlanTier | null;
  status: LeadStatus;
  nextAction: string | null;
  /** YYYY-MM-DD. */
  nextActionAt: string | null;
  notes: string | null;
  convertedAdministratorId: string | null;
  convertedAt: string | null;
  createdAt: string;
  /** Present when the lead comes from a «Solicitud de alta de comunidad». */
  onboardingRequest: { id: string; communityName: string; communityAddress: string | null; requestedByName: string; status: EstateOnboardingStatus } | null;
  convertedAdministrator: { id: string; name: string } | null;
  followUpCount: number;
  lastFollowUpAt: string | null;
}

export interface LeadDetail extends Lead {
  followUps: CommercialFollowUp[];
}

/** Lead fields sent on create/update; `null` clears a field. */
export interface LeadInput {
  name?: string;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  city?: string | null;
  origin?: Exclude<LeadOrigin, 'solicitud_alta'>;
  planOfInterest?: PlanTier | null;
  status?: Exclude<LeadStatus, 'convertido'>;
  nextAction?: string | null;
  nextActionAt?: string | null;
  notes?: string | null;
}

/** Despacho data for «Convertir en cliente»; what is not sent comes from the lead. */
export interface ConvertLeadInput {
  cif: string;
  name?: string;
  plan?: PlanTier;
  contactName?: string;
  contactEmail?: string;
  phone?: string;
}

/** Renewal of an annual or term contract: € at stake = MRR × 12, tax excluded. */
export interface ClientRenewal {
  /** YYYY-MM-DD. */
  date: string;
  amount: number;
}

/** What Clientes adds to `GET /admins` per despacho (`GET /clients/overview`). */
export interface ClientCommercialRow {
  administratorId: string;
  /** Fecha de alta, YYYY-MM-DD. */
  signupAt: string;
  nextRenewal: ClientRenewal | null;
  /** Last day any user of the despacho used Domora, YYYY-MM-DD. */
  lastActiveDay: string | null;
  nextAction: string | null;
  nextActionAt: string | null;
}

export interface ClientsOverview {
  kpis: {
    activeClients: number;
    inTrial: number;
    renewals: { count: number; amount: number; windowDays: number };
    churnRisk: number;
  };
  clients: ClientCommercialRow[];
}

export interface AdminInvoice {
  id: string;
  no: string;
  date: string;
  /** Fecha de la operación, que puede diferir de la de expedición. */
  operationDate: string;
  concept: string;
  /** Desglose fiscal: sin él no se puede justificar la cuota repercutida. */
  taxBase: number;
  taxRate: number;
  taxAmount: number;
  /** Base + cuota. Sustituye al antiguo `amount`, que solo guardaba el total. */
  total: number;
  /** Datos del destinatario congelados al emitir — una factura es inmutable. */
  recipientName: string;
  recipientTaxId: string;
  recipientAddress: string;
  status: AdminInvoiceStatus;
}

export type AdminActivityType = 'login' | 'plan_change' | 'discount' | 'invoice' | 'signup' | 'block' | 'message' | 'payment_received' | 'cancellation_requested' | 'onboarding_completed' | 'billing_change';

export interface AdminActivityItem {
  id: string;
  type: AdminActivityType;
  title: string;
  date: string;
  author: string;
}

export type AdminPayMethod = 'Domiciliación' | 'Tarjeta' | 'Transferencia';

/** Billing data the despacho edits itself (`GET/PUT /admin-billing/me`, S17). The IBAN only ever comes masked. */
export interface OwnBillingData {
  businessName: string;
  cif: string;
  address: string;
  email: string;
  paymentMethod: AdminPayMethod;
  ibanMasked: string | null;
}

export type AdminSepaMandateStatus = 'active' | 'revoked';

export interface AdminSepaMandate {
  id: string;
  reference: string;
  creditorId: string;
  debtorName: string;
  ibanMasked: string;
  signedAt: string;
  status: AdminSepaMandateStatus;
  revokedAt: string | null;
  revokedReason: string | null;
  textVersion: string;
  mandateText: string;
}

export interface OwnBilling {
  billing: OwnBillingData | null;
  /** The active SEPA mandate, if any. */
  mandate: AdminSepaMandate | null;
  sepa: {
    /** `false` while Domora has no SEPA creditor identifier configured: domiciliación cannot be chosen. */
    available: boolean;
    creditorId: string | null;
    creditorName: string;
    /** Fresh reference for a new mandate and the exact order text accepted with it. */
    mandateReference: string | null;
    mandateText: string | null;
  };
}

export interface OwnBillingUpdate {
  businessName: string;
  cif: string;
  address: string;
  email: string;
  paymentMethod: AdminPayMethod;
  /** Only to sign a new mandate (first domiciliación or a new account). */
  iban?: string;
  mandate?: { accepted: true; reference: string; debtorName: string };
}

export interface AdminBilling {
  businessName: string;
  cif: string;
  address: string;
  email: string;
  paymentMethod: AdminPayMethod;
  iban: string;
}

export interface Administrator {
  id: string;
  name: string;
  cif: string;
  vatNumber?: string;             // VAT comunitario (opcional, B2B cross-border)
  primaryUserId?: string;         // FK → User.id del contacto principal de la gestora
  plan: PlanTier;
  tier: string;
  endDate: string;
  /**
   * @deprecated calcular al vuelo con
   * `AdminsService.countActiveUsersForAdministrator(id)`. Las membresías
   * `pending` NO computan en la cuota del plan — solo `linked`.
   * Se mantiene aquí para el dashboard rol A hasta que se migre a la
   * vista derivada `vw_admin_users_active`.
   */
  usersActive: number;
  usersMax: number;
  status: AdminStatus;
  phone: string;
  contactName: string;
  contactEmail: string;
  mrr: number;
  discountPct: number;
  discountReason?: string;
  discountUntil?: string;
  billingInterval: BillingInterval;
  notes: string;
  // AdminBilling es 1:1 opcional en el backend (admin_billing) — null hasta
  // que alguien complete el modal de "Modificar facturación" por primera vez.
  billing: AdminBilling | null;
  fincas: AdminFinca[];
  invoices: AdminInvoice[];
  activity: AdminActivityItem[];
  blockReason?: string;
  /** Sent by `GET /admins` and `GET /admins/:id` (role A); optional until the admins mapper reads them. */
  clientStatus?: ClientStatus;
  paymentStatus?: PaymentStatus;
  pendingInvoices?: PendingInvoicesSummary;
}

export type EstateOnboardingStatus = 'pending' | 'contacted' | 'dismissed';

/** Cola de revisión manual (rol A) para altas de comunidad nueva — ver add-property.component.ts. */
export interface EstateOnboardingRequest {
  id: string;
  communityName: string;
  communityAddress?: string;
  adminName?: string;
  adminEmail?: string;
  status: EstateOnboardingStatus;
  createdAt: string;
  requestedByName: string;
  requestedByEmail: string;
}

/**
 * IBAN del acreedor SIEMPRE enmascarado — nunca viaja en claro por API
 * salvo en la generación server-side del pain.008 (ver
 * backend/src/sepa/remesas.service.ts). "Editar" reemplaza, no revela.
 */
export interface EstateSepaBilling {
  creditorId: string | null;
  creditorIbanMasked: string | null;
  creditorBic: string | null;
  creditorPostalAddress: string | null;
}

// ── Empresa de la gestora vista por ella misma (rol B) ──────────────────
export interface OwnAdministrator {
  id: string;
  name: string;                        // razón social — solo lectura para la gestora
  cif: string;                         // solo lectura para la gestora
  vatNumber: string | null;
  phone: string | null;
  contactName: string | null;
  contactEmail: string | null;
  fiscalAddress: string | null;        // de los datos de facturación; solo lectura
}

export type OwnAdministratorPatch = Partial<Pick<OwnAdministrator, 'vatNumber' | 'phone' | 'contactName' | 'contactEmail'>>;

// ── Puesta en marcha de una finca (derivado en backend, nunca persistido) ──
export type EstateSetupStepKey = 'fiscal' | 'properties' | 'quotas' | 'coefficients' | 'owners' | 'sepa' | 'opening' | 'linked';
export type EstateSetupStepStatus = 'done' | 'pending' | 'warning';
/** `required` cuenta para "completa"; `recommended` avisa sin bloquear; `info` solo informa. */
export type EstateSetupStepWeight = 'required' | 'recommended' | 'info';

export interface EstateSetupStep {
  key: EstateSetupStepKey;
  weight: EstateSetupStepWeight;
  status: EstateSetupStepStatus;
  done?: number;
  total?: number;
}

export interface EstateSetupSummary {
  estateId: string;
  requiredDone: number;
  requiredTotal: number;
  complete: boolean;
  /** Propietarios importados con email y sin cuenta. */
  invitableOwners: number;
}

export interface EstateSetupStatus extends EstateSetupSummary {
  steps: EstateSetupStep[];
}

export type EstateType = 'Edificio' | 'Urbanización' | 'Garaje' | 'Trasteros' | 'Local';

export interface Estate {
  id: string;
  administratorId: string;
  name: string;
  type: EstateType;
  address: string;
  catastroFacadeUrl?: string | null;
  /** Cuándo se subió la foto de la finca (hay foto propia si no es null); se pide por GET estates/:id/photo. */
  photoUpdatedAt?: string | null;
  streetNumber?: string;
  location: string;
  description?: string | null;         // presentación libre de la finca (≤ 600) que muestra el Resumen
  province?: string | null;            // necesaria para consultar el Catastro por dirección
  postalCode?: string | null;
  cadastralReference?: string | null;  // referencia catastral de la PARCELA (14 caracteres)
  properties: number;
  residents: number;
  requests: number;
  activeIssues: number;
  occupancy: number;
  reserveTarget: number;               // fondo de reserva objetivo (LPH art. 9.1.f)
  iban?: string;                       // IBAN de referencia general de la finca (no el acreedor SEPA, ver creditorIban)
  color?: string | null;               // '#RRGGBB' — identificador visual de la tarjeta, editable; null = color automático

  // ── Datos fiscales / SEPA de la comunidad ────────────────────────────
  // La comunidad de propietarios es el acreedor SEPA de las cuotas.
  // No los guarda la gestora — cada finca tiene su propio CIF y su propio CID.
  cif?: string | null;                 // CIF de la comunidad (formato español 'H12345678'); null = sin informar
  creditorId?: string;                 // CID SEPA — ES + 2 dígitos control + 3 chars + NIF/CIF
  creditorIban?: string;               // IBAN receptor de los cobros (sustituye a AccountingEstate.iban)
  creditorBic?: string;                // BIC del banco receptor (útil para OrgnlDbtrAcct en amendments)
  creditorPostalAddress?: string;      // dirección postal para el bloque Cdtr del pain.008

  // ── Datos generales (se editan en «Editar finca»; la pestaña solo los muestra) ──
  yearBuilt?: number | null;
  mainUse?: EstateMainUse | null;
  internalRef?: string | null;
  taxRegime?: string | null;
  applicableLaw?: string | null;
  notes?: string | null;
  /** Superficie de la parcela según el Catastro (m²). */
  parcelAreaM2?: number | null;
  /** Ubicación WGS84 para el mapa; la calcula el backend (Catastro o Nominatim). */
  latitude?: number | null;
  longitude?: number | null;
}

export const ESTATE_MAIN_USES = ['Residencial', 'Mixto', 'Comercial', 'Oficinas', 'Garajes y trasteros', 'Otro'] as const;
export type EstateMainUse = (typeof ESTATE_MAIN_USES)[number];

export type PropertyStatus = 'Ocupado' | 'Vacío' | 'Reservado';
export type RoleType = 'Propietario' | 'Inquilino' | 'Representante' | 'Otro' | null;

// La interfaz `Property` queda como alias de la entidad canónica OwnerProperty
// (ver más abajo). Componentes y mocks aún tipados como `Property` siguen
// funcionando — se eliminará el alias cuando todos los call-sites estén
// migrados al nombre canónico.
//
// Nota: el antiguo Property (DTO admin con `type/ref/floor/door/staircase/owner/
// roleType/status`) deja de existir como interfaz independiente — sus campos
// ahora viven en OwnerProperty, que se ha enriquecido con:
//   - identificación catastral completa (viaType/viaName/streetNumber/…)
//   - referencia interna corta (`ref`)
//   - escalera (`staircase`)
//   - estado de ocupación (`status`)
// y la titularidad (`owner`, `roleType`) se DERIVA de property_memberships +
// external_owners en lugar de almacenarse como string.

// ── Adhesion requests (formalizada) ────────────────────────────────────
//
// El VÍNCULO real usuario ↔ propiedad vive en `PropertyMembership` (con
// status pending/linked/revoked). `AdhesionRequest` guarda solo la
// METADATA del proceso de validación: quién solicitó, quién resolvió,
// cuándo, decisión y motivo.
//
// Regla de coherencia:
//  - Al crear una solicitud → se crea también una membership con
//    status='pending' (para que el rol C vea la propiedad en su dashboard
//    marcada como pendiente).
//  - Al aprobar → adhesion_request.decision='approved', membership.status='linked'.
//  - Al rechazar → adhesion_request.decision='rejected', membership.status='revoked'
//    (o se elimina). Se mantiene la fila de adhesion_request como histórico.

export type AdhesionDecision = 'approved' | 'rejected';
export type AdhesionStatus = 'pending' | 'approved' | 'rejected';

export interface AdhesionRequest {
  id: string;
  estateId: string;
  propertyId: string | null;         // NULL si solicita una propiedad inexistente
  userId: string;                    // FK → User.id (quien solicita)
  roleType: MembershipRoleType;
  submittedAt: string;
  status: AdhesionStatus;
  resolvedAt?: string | null;
  resolvedByUserId?: string | null;  // admin que aprobó/rechazó
  decision?: AdhesionDecision;
  notes?: string;                    // motivo del rechazo, comentarios, etc.
}

// ── Alertas (VISTA derivada, no tabla persistente) ────────────────────
//
// Las alertas del rol C NO son una entidad propia. Son una proyección
// (UNION ALL con discriminador) sobre:
//  - Recibos pendientes con dueDate < hoy → tipo 'pago'
//  - Incidencias activas del propietario → tipo 'incidencia'
//  - Eventos próximos (junta) → tipo 'junta'
//  - Documentos no leídos → tipo 'documento'
//  - Comunicados no leídos → tipo 'comunidad'
//
// El estado leído/no-leído POR USUARIO vive en `ResourceRead` (una entrada
// por combinación userId + sourceType + sourceId). Esta MISMA tabla
// resuelve TAMBIÉN el estado de lectura de Comunicados y Documentos fuera
// del feed de Alertas — es decir, si el usuario lee un comunicado desde la
// pestaña "Comunicados", automáticamente deja de aparecer como no-leído en
// "Alertas" (y viceversa), porque ambas vistas consultan el mismo estado.

export type AlertSourceType = 'issue' | 'receipt' | 'communication' | 'document' | 'event' | 'meeting' | 'supplier_contract' | 'budget_item';
export type AlertType = 'pago' | 'incidencia' | 'junta' | 'documento' | 'comunidad' | 'proveedor' | 'presupuesto';

export interface AlertItem {
  id: string;                        // sintético: `${sourceType}:${sourceId}`
  sourceType: AlertSourceType;
  sourceId: string;
  userId: string;                    // destinatario
  type: AlertType;
  title: string;
  description: string;
  date: string;                      // fecha original del recurso
  urgent: boolean;
  propertyId?: string;
  propertyLabel?: string;            // computed para display
  estateId?: string | null;          // solo poblado en el feed de rol B
  read: boolean;                     // resuelto contra ResourceRead
}

/**
 * Estado de lectura de un recurso por usuario. Generaliza lo que en el
 * primer borrador de este gap iban a ser DOS tablas separadas
 * (`communication_reads`, `document_reads`) además de la ya existente
 * `alert_reads` — se unifican en una sola porque las tres modelan
 * exactamente lo mismo: "¿ha visto el usuario X el recurso Y?".
 */
export interface ResourceRead {
  userId: string;
  sourceType: AlertSourceType;
  sourceId: string;
  readAt: string;
}

/** @deprecated alias de compatibilidad. Usar `ResourceRead`. */
export type AlertRead = ResourceRead;

export type OwnerPropertyType = 'Piso' | 'Casa' | 'Parking' | 'Trastero' | 'Local';
export type LinkageStatus = 'none' | 'pending' | 'linked' | 'revoked';

// Tipos de vía homologados con los códigos DGC (Dirección General del Catastro).
// La lista no es exhaustiva pero cubre los más comunes; el campo se mantiene
// como string libre para permitir 'Otro' o casos atípicos.
export type ViaType =
  | 'Calle' | 'Avenida' | 'Plaza' | 'Paseo' | 'Camino' | 'Carretera'
  | 'Travesía' | 'Pasaje' | 'Ronda' | 'Glorieta' | 'Vía' | 'Polígono'
  | 'Urbanización' | 'Lugar' | 'Otro';

export interface PropertyEvent {
  title: string;
  date: string;
  day: string;
  month: string;
  location: string;
  room: string;
  time: string;
}

// ── Property (entidad canónica de unidad inmobiliaria) ──────────────────
// Tabla única `properties` en el modelo destino. Contiene la identificación
// física del inmueble (datos catastrales) y referencia a su finca y tenant.
// Los datos por-usuario (nickname, balance, KPIs) NO viven aquí: se obtienen
// vía property_memberships + cálculo al vuelo sobre receipts/issues/docs.
export interface OwnerProperty {
  id: string;
  type: OwnerPropertyType;

  // ── Pertenencia ──────────────────────────────────────────────────────
  estateId: string | null;            // null para propiedades privadas sin finca/gestora
  administratorId: string | null;     // denormalizado para queries rápidas
  status: PropertyStatus;             // ocupación (Ocupado/Vacío/Reservado)

  // ── Identificación catastral / postal ────────────────────────────────
  // Alineado con la Dirección General del Catastro (DGC). Permite identificar
  // un inmueble de forma inequívoca, ordenar tablas por planta/puerta y
  // emitir notificaciones postales con el formato estándar.
  viaType?: ViaType;                   // 'Calle', 'Paseo', 'Plaza'…
  viaName?: string;                    // 'de la Castellana', 'Mayor'…
  streetNumber?: string;               // '145'
  streetNumberSuffix?: string;         // '145bis', '145A'
  block?: string;                      // bloque (urbanizaciones)
  staircase?: string;                  // escalera ('1', '2', 'A')
  floor?: string;                      // planta ('1', '2', 'B1', 'ÁTICO')
  door?: string;                       // puerta ('A', 'B', '3')
  postalCode?: string;
  municipality?: string;               // localidad / municipio
  province?: string;
  country?: string;                    // ISO 3166-1 alpha-2; 'ES' por defecto
  cadastralReference?: string;         // Referencia catastral DGC (20 chars)

  // ── Identificadores cortos ───────────────────────────────────────────
  ref?: string;                        // referencia corta interna ('1A', 'P-14', 'L-01')

  // ── Económico ────────────────────────────────────────────────────────
  quotaMonthly: number;
  /**
   * Coeficiente de participación en la finca (%, 0-100). null = sin
   * informar. Lo fija la gestora (el propietario no puede editarlo) y es
   * la base del quórum por cuota en las juntas. La API lo serializa como
   * string (Decimal) — PropertiesService lo normaliza a número.
   */
  participationQuota?: number | null;
  /** Superficie construida (m²) — del Catastro, del recálculo por m² o a mano. Decimal → PropertiesService lo normaliza a número. */
  builtAreaM2?: number | null;
  /** Cuándo se leyeron del Catastro los datos de la propiedad (ISO). */
  catastroSyncedAt?: string | null;
  iban?: string;                       // si la propiedad tiene cuenta de cargo propia distinta del titular

  // ── Membresía / titular principal ────────────────────────────────────
  primaryUserId?: string;              // FK al titular principal (derivable de memberships)

  // ── DERIVADOS (no almacenar en backend — calcular al vuelo) ──────────
  // Estos campos se mantienen en el mock como columnas pobladas a mano,
  // pero en backend real se calculan sobre receipts/issues/documents.
  balance: number;
  /**
   * Anticipo sin aplicar (dinero cobrado que todavía no se imputó a
   * ningún recibo) — NUNCA se resta de `balance`. Aplicarlo es una acción
   * explícita de la gestora, no algo que la UI decida sola. Solo lo trae
   * `resolvePropertyView`; en otros listados puede venir `undefined`.
   */
  advance?: number;
  pendingDocs: number;
  openIssues: number;
  nextEvent?: PropertyEvent;

}

/**
 * @deprecated Alias de compatibilidad. Usa `OwnerProperty` (entidad canónica
 * de propiedad). Permite retirar la antigua interfaz `Property` (DTO admin)
 * sin romper componentes ya tipados como `Property` hasta que migren al
 * nombre canónico.
 */
export type Property = OwnerProperty;

// ── Property View (proyección resuelta con JOINs para la UI) ──────────
//
// Es lo que en el modelo destino sería una VIEW en la BBDD: agrega la
// propiedad canónica con la finca, gestora, contacto del administrador,
// membresía del usuario y campos derivados (nickname, dirección postal).
//
// El objetivo es que los componentes NO lean nunca directamente los
// campos deprecados de `OwnerProperty` — un rename de la finca solo debe
// tocar `Estate.name`, no todas las filas del mock ni ningún string.

export interface PropertyView {
  property: OwnerProperty;
  estate: Estate | null;
  /** Solo datos de contacto de la gestora: el backend no envía plan, MRR, descuentos ni notas al propietario. */
  admin: Pick<Administrator, 'id' | 'name' | 'phone' | 'contactName' | 'contactEmail'> | null;
  adminContact: Pick<User, 'id' | 'fullName' | 'email' | 'phone'> | null;
  membership: PropertyMembership | null;
  // ── Campos "vivos" resueltos ─────────────────────────────────────────
  estateName: string | null;
  adminName: string | null;
  adminContactName: string | null;
  nickname: string;                  // membership.nickname o fallback (property.type)
  viewerRoleType: RoleType;
  isLinked: boolean;
  linkageStatus: MembershipStatus | 'none';
  addressFull: string;               // dirección postal formateada
}

// ── Reservas (Rol C) / Instalaciones (Rol B) ────────────────────────────

export interface Amenity {
  id: string;
  estateId: string;
  name: string;
  icon: string;
  color: string;
  bg: string;
  maxHours: number;
  slots: string[];
  rules: string;
  capacity: number;
  seasonal?: boolean;
  seasonLabel?: string;
  active: boolean;
}

/** Periodo de indisponibilidad por mantenimiento de una instalación concreta. */
export interface AmenityBlackout {
  id: string;
  amenityId: string;
  startDate: string;   // 'YYYY-MM-DD'
  endDate: string;      // 'YYYY-MM-DD'
  reason?: string;
}

export interface AmenityAvailability {
  amenityId: string;
  date: string;
  slots: string[];
  occupied: string[];
  blocked: boolean;
  blockedReason?: string;
}

export type BookingStatus = 'confirmed' | 'completed' | 'cancelled';

export interface Booking {
  id: string;
  amenityId: string;
  amenityName: string;
  date: string;        // 'YYYY-MM-DD'
  startSlot: string;    // '10:00'
  endSlot: string;       // '12:00'
  status: BookingStatus;
  createdAt: string;
  guests: number;
  notes?: string;
  // Solo presentes en la vista de administración (listBookingsForEstate).
  propertyLabel?: string;
  userName?: string;
}

// ── Juntas de propietarios y videollamada ────────────────────────────────

export type MeetingType = 'ordinaria' | 'extraordinaria';
/** convocada → celebrada → firmada (acta firmada por presidente y secretario); cancelada sale de convocada. */
export type MeetingStatus = 'convocada' | 'celebrada' | 'cancelada' | 'firmada';
export type MeetingConvokedBy = 'presidente' | 'cuotas25' | 'propietarios25' | 'mandatoJudicial';
export type MeetingSignerRole = 'administrador' | 'presidente' | 'secretario';

/** Solo se captura como dato — la ejecución real de la votación es una historia aparte. */
export interface VoteQuestion {
  title: string;
  type: 'single_choice' | 'multiple_choice' | 'text';
  options?: string[];
  /**
   * Color (`#RRGGBB`) de cada respuesta, en el mismo orden que `options`; `''` = el de por defecto.
   * Es como las ve quien vota.
   */
  optionColors?: string[];
  /**
   * Mayoría con la que se aprueba la pregunta (art. 17 LPH). Se elige al preparar la junta
   * (paso 2 del asistente) y al abrir la votación se usa tal cual; las juntas anteriores
   * pueden no tenerla. No aplica a preguntas de texto libre.
   */
  majorityType?: VoteMajorityType;
}

export interface VoteTemplate {
  questions: VoteQuestion[];
}

export interface AgendaItem {
  /** Stable semantic identity; retained when the title is edited. */
  systemKey?: import('./ordinary-agenda').OrdinaryAgendaKey;
  systemGenerated?: boolean;
  id: string;
  title: string;
  description?: string;
  hasVote?: boolean;
  voteTemplate?: VoteTemplate;
  /** Cuándo se dio por tratado un punto sin votación (los puntos con votación se tratan al cerrar su votación). */
  treatedAt?: string | null;
  /** Comentarios del administrador sobre el punto: salen en el acta. */
  comments?: string | null;
}

export interface Meeting {
  id: string;
  estateId: string;
  title: string;
  type: MeetingType;
  status: MeetingStatus;
  scheduledAt1: string;
  scheduledAt2: string;
  agenda: AgendaItem[];
  convokedBy: MeetingConvokedBy;
  location?: string;
  locationPlaceId?: string;
  locationLat?: number;
  locationLng?: number;
  signerRole: MeetingSignerRole;
  signerName?: string;
  /** Snapshot de emails al crear — no son necesariamente usuarios de la plataforma. */
  attendeeEmails: string[];
  includeJitsi: boolean;
  jitsiRoomName?: string | null;
  jitsiAccessPassword?: string | null;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  /** Constancia explícita de la gestora de respaldo estatutario (art. 17.6 LPH) para asistencia telemática — null = no confirmado, muestra aviso. */
  telematicBackingConfirmedAt?: string | null;
  telematicBackingConfirmedByUserId?: string | null;
  /** Fijado al pasar a 'celebrada' — ancla estable de los plazos de acta (10 días) e impugnación (3 meses). */
  celebratedAt?: string | null;
  actaS3Key?: string | null;
  actaSignedAt?: string | null;
  actaSignedByPresidenteUserId?: string | null;
  actaSignedBySecretarioUserId?: string | null;
  actaDistributedAt?: string | null;
  /** Texto libre de la gestora para el acta: comentarios generales y próximos pasos. */
  actaGeneralComments?: string | null;
  actaNextSteps?: string | null;
  /** Datos reales de la reunión, confirmados por la gestora al preparar el acta (null = no constan). */
  actualStartAt?: string | null;
  actualEndAt?: string | null;
  effectiveConvocation?: 'primera' | 'segunda' | null;
  /** La gestora exige 2FA para votar en ESTA junta (nunca obligatorio globalmente) — editable solo antes de que exista ninguna VoteSession. */
  require2faForVoting?: boolean;
  // Añadidos por el backend (MeetingsService.withLinks) — no son columnas.
  waitRoomUrl?: string;
  beaconUrl?: string;
  jitsiUrl?: string | null;
  state?: MeetingState | null;
}

export interface MeetingState {
  meetingId: string;
  adminReady: boolean;
  adminLastSeenAt?: string | null;
  scheduledStartAt?: string | null;
  announcement?: string | null;
  announcementSetAt?: string | null;
  redirectRequestedAt?: string | null;
}

export interface MeetingPresenceEntry {
  meetingId: string;
  userId: string;
  username: string;
  building?: string | null;
  unit?: string | null;
  floor?: string | null;
  lastSeenAt: string;
}

export interface MeetingChatMessage {
  id: string;
  meetingId: string;
  senderId: string;
  senderName: string;
  text: string;
  sentAt: string;
}

export type MeetingAttendanceSource = 'jitsi' | 'manual';

export interface MeetingAttendee {
  id: string;
  meetingId: string;
  propertyId: string;
  userId: string;
  displayName: string;
  role: 'attendee' | 'admin';
  source: MeetingAttendanceSource;
  markedByUserId?: string | null;
  joinedAt: string;
  /** Poblado por el backend (`include: { property }`). */
  property?: { ref: string | null };
}

export interface MeetingVoteDelegation {
  id: string;
  meetingId: string;
  propertyId: string;
  delegatorUserId: string;
  /** null = representante externo sin cuenta (`representativeName` + `representativeDni`). */
  representativeUserId: string | null;
  representativeName?: string | null;
  representativeDni?: string | null;
  documentS3Key?: string | null;
  notes?: string;
  createdAt: string;
  createdByUserId: string;
  revokedAt?: string | null;
  revokedByUserId?: string | null;
  revocationReason?: string;
  // Poblados por el backend (`include`).
  property?: { ref: string | null };
  delegatorUser?: { fullName: string; email: string };
  representativeUser?: { fullName: string; email: string } | null;
}

export interface QuorumResult {
  convocatoria: 'primera' | 'segunda';
  /** Cómo se determinó la convocatoria: solo `explicit` y `confirmed` son datos confirmados. */
  convocatoriaSource?: 'explicit' | 'confirmed' | 'at' | 'now' | 'celebratedAt' | 'scheduledAt2';
  /** Art. 16 LPH: en segunda convocatoria no hay quórum exigible. */
  quorumRequired: boolean;
  quorumMet: boolean;
  owners: { present: number; total: number; percent: number };
  quota: { present: number; total: number; percent: number };
  /** Propiedades del censo sin coeficiente asignado — no cuentan en el % de cuotas. */
  missingParticipationQuotaCount: number;
  attendingProperties: {
    propertyId: string;
    ref: string | null;
    participationQuota: string | null;
    attendeeNames: string[];
  }[];
}

export interface AttendanceOption {
  propertyId: string;
  label: string;
  kind: 'own' | 'delegated';
}

/** Titular con cuenta vinculado a una propiedad. */
export interface PropertyHolder {
  userId: string;
  name: string;
}

export interface PropertyHolders {
  propertyId: string;
  holders: PropertyHolder[];
}

export interface EligibleAttendee {
  userId: string;
  name: string;
  kind: 'own' | 'delegated';
}

// ── Votación real del orden del día (Fase 2.1) ──────────────────────────

export type VoteMajorityType = 'unanimidad' | 'tresQuintos' | 'mayoriaSimple';
export type VoteSessionStatus = 'abierta' | 'cerrada';

export interface VoteTallyOptionCount {
  optionIndex: number;
  propertyCount: number;
}

export interface VoteTallyResult {
  /** 'censo' para unanimidad/tresQuintos (art. 17.2 LPH), 'presentes' solo para mayoriaSimple (art. 17.7). */
  denominatorBasis: 'censo' | 'presentes';
  ownersFavorablePct: number;
  ownersDenominatorCount: number;
  quotaFavorablePct: number;
  quotaDenominatorTotal: number;
  /** null para preguntas multiple_choice — sin noción legal clara de "favorable" en selección múltiple. */
  passed: boolean | null;
  optionTally: VoteTallyOptionCount[];
}

export interface VoteSession {
  id: string;
  meetingId: string;
  agendaItemId: string;
  questionIndex: number;
  majorityType: VoteMajorityType;
  status: VoteSessionStatus;
  openedAt: string;
  openedByUserId: string;
  closedAt?: string | null;
  closedByUserId?: string | null;
  require2fa: boolean;
  resultSummary?: VoteTallyResult | null;
  /** Solo poblado por `list()` mientras la sesión sigue abierta — recuento en vivo, no persistido. */
  liveTally?: VoteTallyResult | null;
}

/** Voto emitido por una propiedad en una sesión (solo lo ve la gestora). */
export interface VoteResponseEntry {
  propertyId: string;
  propertyRef: string | null;
  /** Quien emitió el voto: el titular o su representante (puede ser una persona externa sin cuenta). */
  voterName: string;
  /** Gestora que lo registró en nombre del votante; `null` si votó él mismo. */
  registeredByName: string | null;
  optionIndex: number | null;
  optionIndexes: number[];
  castAt: string;
}

export interface OpenVoteSessionPayload {
  agendaItemId: string;
  questionIndex: number;
  majorityType: VoteMajorityType;
}

/** La gestora registra el voto de una propiedad presente o representada. */
export interface RegisterVotePayload {
  propertyId: string;
  optionIndex?: number;
  optionIndexes?: number[];
  /** La gestora anula la privación de voto por deuda (art. 15.2 LPH) tras confirmarlo. */
  overrideDebt?: boolean;
}

/** Deuda vencida de una propiedad (solo la ve la gestora). */
export interface PropertyDebt {
  propertyId: string;
  amount: number;
}

/** Si quien consulta puede votar por su propiedad; `reason: 'debt'` solo se revela a quien puede actuar por ella. */
export interface VotingRight {
  canVote: boolean;
  reason: 'debt' | null;
}

export interface CastVotePayload {
  propertyId: string;
  optionIndex?: number;
  optionIndexes?: number[];
  /** Solo exigido si la sesión tiene `require2fa` — TOTP o código de respaldo. */
  totpCode?: string;
}

// ── Verificación en dos pasos (Fase 2.3) — opcional por usuario, nunca obligatoria global ──

export interface TwoFactorEnrollment {
  secret: string;
  qrDataUrl: string;
}

export interface TwoFactorBackupCodes {
  backupCodes: string[];
}

// ── Histórico de participación (Fase 2.4) ───────────────────────────────

export interface ParticipationHistoryEntry {
  meetingId: string;
  title: string;
  celebratedAt: string | null;
  quorumMet: boolean;
  /** % de propiedades del censo con alguna delegación de voto para esa junta. */
  delegationUsageRate: number;
}

/** Línea del orden del día tal y como se imprime en la convocatoria (`01`, `02`…). */
export interface ConvocatoriaAgendaLine {
  number: string;
  text: string;
}

/**
 * Texto de la convocatoria de una junta (art. 16.2 LPH), ya resuelto: lo que la gestora revisa y edita en el
 * tercer paso del alta y lo que sale en el `.docx`.
 */
export interface ConvocatoriaDocument {
  header: { community: string; title: string };
  /** Aviso en cursiva bajo la cabecera. */
  notice: string;
  /** `en Madrid a 9 de septiembre de 2026`. */
  issuedLine: string;
  greeting: string;
  /** Párrafo de convocatoria con fecha, horas y lugar. */
  intro: string;
  agenda: ConvocatoriaAgendaLine[];
  closing: string;
  /** Líneas de la firma (cargo, nombre, nº de colegiado…). */
  signature: string[];
  /** Autorización para delegar el voto, a recortar al pie. */
  authorization: { enabled: boolean; text: string };
}

/** Datos del borrador con los que el servidor redacta la convocatoria habitual. */
export interface ConvocatoriaPreviewPayload {
  type: MeetingType;
  convokedBy: MeetingConvokedBy;
  scheduledAt1: string;
  scheduledAt2: string;
  location?: string;
  agenda: AgendaItem[];
  signerRole: MeetingSignerRole;
  signerName?: string;
}

export interface CreateMeetingPayload {
  title: string;
  type: MeetingType;
  scheduledAt1: string;
  scheduledAt2: string;
  agenda: AgendaItem[];
  convokedBy: MeetingConvokedBy;
  location?: string;
  locationPlaceId?: string;
  locationLat?: number;
  locationLng?: number;
  signerRole: MeetingSignerRole;
  signerName?: string;
  attendeeEmails: string[];
  includeJitsi: boolean;
  /** Solo tiene efecto si `includeJitsi` es `true` — ver `Meeting.telematicBackingConfirmedAt`. */
  telematicBackingConfirmed?: boolean;
  /** Convocatoria editada a mano; sin ella el servidor redacta la habitual al pedirla. */
  convocatoria?: ConvocatoriaDocument;
}

/** Versión guardada del texto del acta (comentarios generales, próximos pasos y comentarios de cada punto). */
export interface ActaVersion {
  id: string;
  versionNumber: number;
  createdAt: string;
  savedByName: string | null;
  generalComments: string | null;
  nextSteps: string | null;
  pointComments: { id: string; title: string; comments: string }[];
}

export interface SaveActaVersionPayload {
  generalComments?: string;
  nextSteps?: string;
  pointComments?: { itemId: string; comments: string }[];
}

/** Documento adjunto a la convocatoria de una junta. `mimeType`/`sizeBytes` son null en adjuntos antiguos. */
export interface MeetingAttachment {
  id: string;
  meetingId: string;
  title: string;
  mimeType: string | null;
  sizeBytes: number | null;
  uploadedAt: string;
}

/** Edición de una junta convocada: solo los datos de la convocatoria (no invitados ni videollamada). */
export type UpdateMeetingPayload = Partial<
  Pick<
    CreateMeetingPayload,
    'title' | 'type' | 'scheduledAt1' | 'scheduledAt2' | 'agenda' | 'convokedBy' | 'location' | 'signerRole' | 'signerName'
  >
>;

// ── Vinculación (Rol C) ─────────────────────────────────────────────────

export interface LinkEstate {
  id: string;
  name: string;
  address: string;
  admin: string;
}

// ── Activity feed (rol C "Actividad reciente") ─────────────────────────
//
// Antes `ActivityItem` se poblaba desde `MOCK_ACTIVITIES`, un array 100%
// estático que nunca reflejaba incidencias, recibos, comunicados o
// documentos reales — el feed no cambiaba aunque cambiaran los datos.
//
// Conviven ya en el modelo varias entidades tipo timeline con forma
// propia (`IssueTimelineEntry`, `DebtorAction`,
// `AdminActivityItem`) — cada una encaja bien en su dominio (autor+rol
// para incidencias, resultado+tipo de gestión para morosidad, etc.) y ya
// fueron normalizadas en gaps anteriores. En vez de forzarlas todas a un
// esquema único (que perdería esos campos específicos y obligaría a
// tocar Issue/Debtor/Admin a la vez), `ActivityItem` se resuelve
// como VISTA DERIVADA sobre las fuentes reales del usuario (recibos,
// incidencias, comunicados, documentos) — mismo patrón que `AlertItem`.
//
// `ActivityLogEntry` cubre la otra mitad: eventos que hoy NO tienen
// ningún timeline propio (recibo cobrado, documento subido, comunicado
// publicado). Es una tabla ligera, pensada para poder ampliarse en el
// futuro a un log de auditoría global si hiciera falta, sin haber tenido
// que reescribir los timelines de dominio que ya funcionan bien.

export type ActivityType = 'incidencia' | 'recibo' | 'comunicado' | 'documento' | 'solicitud';

export interface ActivityItem {
  id: string;
  type: ActivityType;
  title: string;
  description: string;
  date: string;
  propertyId: string;
}

export type ActivitySubjectType = 'issue' | 'receipt' | 'communication' | 'document' | 'membership' | 'regulatory_inspection' | 'meeting' | 'property';
export type ActivityVerb = 'created' | 'updated' | 'status_changed' | 'paid' | 'published' | 'uploaded';

export interface ActivityLogEntry {
  id: string;
  actorUserId?: string;
  subjectType: ActivitySubjectType;
  subjectId: string;
  verb: ActivityVerb;
  summary: string;
  occurredAt: string;
  estateId?: string;
  propertyId?: string;
}

// La interfaz `Receipt` simple queda eliminada como tipo independiente:
// vivía en el rol C con solo 5 campos y duplicaba la realidad de
// `AccountingReceipt`. Ambos representan el MISMO objeto de dominio (un
// recibo emitido a un titular por un periodo). Se unifican en
// `AccountingReceipt` — el alias `type Receipt = AccountingReceipt` más
// abajo mantiene la retrocompatibilidad de imports.

/**
 * Comunicado publicado a la comunidad.
 *
 * El antiguo campo `unread: boolean` era GLOBAL — un único booleano
 * compartido por todos los destinatarios, así que en cuanto un usuario lo
 * leía se marcaba como leído para todos. Eliminado: el estado de lectura
 * ahora se resuelve por usuario vía `ResourceRead` (sourceType='communication')
 * — ver `ResourceReadsService.isCommunicationRead(userId, id)`.
 */
export type CommunicationCategory = 'General' | 'Urgente' | 'Mercadillo' | 'ObjetosPerdidos' | 'Evento';
export type CommunicationSignerRole = 'administrador' | 'presidente' | 'secretario';

export interface CommunicationReply {
  id: string;
  communicationId: string;
  authorUserId?: string | null;
  authorName: string;
  role: 'Propietario' | 'Administrador' | 'Sistema';
  text: string;
  createdAt: string;
}

export interface CommunicationAttachment {
  id: string;
  communicationId: string;
  title: string;
  uploadedAt: string;
}

export interface CommunicationReadReceipt {
  userId: string;
  fullName: string;
  read: boolean;
  readAt: string | null;
}

export interface Communication {
  id: string;
  estateId?: string;      // FK → Estate.id (para poder filtrar por finca)
  title: string;
  body: string;
  date: string;
  from: string;
  authorUserId?: string | null;
  authorName?: string | null;
  /** Calculado en el servidor en cada consulta (archivo manual O `activeUntil` vencido) — nunca es un campo propio en base de datos. */
  archived: boolean;
  activeUntil?: string | null;
  lastEditedByUserId?: string | null;
  lastEditedByName?: string | null;
  lastEditedAt?: string | null;
  category: CommunicationCategory;
  /** null = toda la finca; si no, solo la propiedad indicada (mismo patrón que Document.targetPropertyId). Solo A/B puede fijarlo. */
  targetPropertyId?: string | null;
  /** null = no fijado. Es la fecha, no un booleano, para que un post refijado más tarde vuelva a subir en el orden. */
  pinnedAt?: string | null;
  /** LPH art. 9.1.h — "notificación fehaciente por tablón", último recurso. Solo A/B puede marcarlo. */
  isLegalNotice: boolean;
  legalNoticeSignerRole?: CommunicationSignerRole | null;
  legalNoticeSignerName?: string | null;
  legalNoticeReason?: string | null;
  legalNoticeCountersignedByPresident?: boolean;
  /** Calculados en el servidor (createdAt + 3 días naturales) — nunca persistidos. */
  legalNoticeEffectiveAt?: string | null;
  legalNoticeEffective?: boolean;
  replies: CommunicationReply[];
  attachments: CommunicationAttachment[];
}

export type IssueType = 'Avería' | 'Ruido' | 'Daño estructural' | 'Fuga' | 'Seguridad' | 'Limpieza' | 'Otro';
export type IssueStatus = 'Abierta' | 'En reparación' | 'Pendiente proveedor' | 'Pendiente de información' | 'Resuelta' | 'Cerrada' | 'Retirada';

export interface IssueTimelineEntry {
  date: string;
  author: string;                       // legacy display name
  role: 'Propietario' | 'Administrador' | 'Sistema';
  text: string;
  // FK al actor real, y en su caso al representado (auditoría completa).
  authorUserId?: string;
  onBehalfOfUserId?: string | null;
  /** Instante exacto (ISO) del evento: `date` solo conserva el día. Sirve para decir CUÁNDO se comunicó algo. */
  at?: string;
  /** Qué ocurrió (catálogo del backend). Ausente en entradas antiguas = nota. */
  kind?: string;
  /** Quién actuó: persona, Domora (ai), sistema o un tercero. */
  actorKind?: 'person' | 'ai' | 'system' | 'external';
  /** Datos para mostrar (canal, contraparte…). Nunca se pintan en bruto. */
  meta?: Record<string, unknown> | null;
  /** Nota interna de la gestión: la API nunca se la envía a quien avisó ni a los vecinos. */
  internal?: boolean;
}

/**
 * Incidencia (Issue).
 *
 * Los campos legacy `provider`, `providerCategory`, `providerPhone`,
 * `providerResolutionDate`, `notifiedDate`, `notifiedCount` han sido
 * ELIMINADOS — sustituidos por tablas independientes:
 *
 *  - `IssueProviderAssignment` (tabla `issue_providers`): asigna
 *    proveedor con FK opcional a `suppliers` + snapshot congelado al
 *    asignar. Permite tener histórico de cambios de proveedor.
 *
 *  - `IssueNotification` (tabla `issue_notifications`): una entrada por
 *    envío. Antes solo se guardaba UNA notificación (fecha + cuenta);
 *    ahora cada reenvío añade una fila con canal y destinatarios.
 *
 * El budget queda como fields planos porque hoy solo hay un presupuesto
 * por incidencia. Cuando aparezcan multi-presupuesto (comparativa), se
 * extraerá a una tabla `issue_budgets` con el mismo patrón.
 */
/** Foto adjunta a una incidencia; el fichero se descarga aparte (`/issues/:id/photos/:photoId/file`). */
export interface IssuePhoto {
  id: string;
  uploadedAt?: string;
}

export interface Issue {
  id: string;
  ref: string;
  type: IssueType;
  title: string;
  description: string;
  status: IssueStatus;
  priority: 'Normal' | 'Urgente';
  source: 'Propietario' | 'Comunidad';
  date: string;
  /** Última vez que se tocó la incidencia (el servidor la manda en el detalle). */
  updatedAt?: string;
  photos: IssuePhoto[];
  timeline: IssueTimelineEntry[];
  /** La comunidad (finca) de la incidencia: una incidencia es siempre de la comunidad, no de una vivienda. */
  estateId?: string;
  /** Solo para un vecino: ¿es de quienes la reportaron? (solo ellos añaden notas y fotos). */
  reportedByMe?: boolean;
  owner?: string;
  budgetAmount?: number;
  budgetDescription?: string;
  budgetApproved?: boolean;
  /** Instalación (elemento común) a la que se refiere, si la gestión la indicó. Opcional. */
  assetId?: string | null;
  asset?: { id: string; name: string } | null;
  /** Vía de gestión decidida por una persona; null/ausente = por determinar. */
  resolutionRoute?: string | null;
  /** Avisos recibidos (solo en el detalle, solo gestión): permite saber a quién informar. */
  reports?: IssueReportRef[];
  /** Zona o instalación afectada, como la indicó quien avisó ("Portal 1", "Piscina", texto libre). Nunca una vivienda. */
  location?: string | null;
  /** Estado al que vuelve la incidencia cuando quien avisó responde a una solicitud de información. */
  statusBeforeInfoRequest?: IssueStatus | null;
  /** Valoración (1-5) de la resolución por quien avisó, y su comentario. */
  rating?: number | null;
  ratingComment?: string | null;
}

/** Aviso original de una incidencia; `reporterUserId` es quien la reportó con cuenta de Domora. */
export interface IssueReportRef {
  id: string;
  channel: string;
  reporterUserId: string | null;
  reporterName: string | null;
  receivedAt: string;
}

// ── Issue provider assignments (histórico) ────────────────────────────
//
// Cada asignación de proveedor a una incidencia genera una fila. La
// asignación vigente es la más reciente con `unassignedAt=null`. El
// snapshot congelado (`providerNameSnapshot`, etc.) evita que un rename
// del proveedor en `suppliers` altere el histórico de la incidencia.
export interface IssueProviderAssignment {
  id: string;
  issueId: string;
  supplierId?: string | null;              // FK a Supplier — null si es ad-hoc
  providerNameSnapshot: string;
  categorySnapshot?: string;
  phoneSnapshot?: string;
  estimatedResolutionDate?: string;
  assignedAt: string;
  /** `null` cuando la asignó Domora sola (envío automático): nunca se atribuye a una persona que no lo hizo. */
  assignedByUserId: string | null;
  assignedByKind?: 'person' | 'ai' | 'system';
  unassignedAt?: string | null;            // null = vigente
}

// ── Issue notifications (histórico) ───────────────────────────────────
//
// Antes solo se guardaba una notificación (`notifiedDate` + `notifiedCount`)
// perdiendo el histórico si se reenviaba. Ahora cada envío es una fila.
export type NotificationChannel = 'email' | 'push' | 'sms' | 'mixed';

export interface IssueNotification {
  id: string;
  issueId: string;
  sentAt: string;
  recipientsCount: number;
  channel: NotificationChannel;
  sentByUserId: string;
  subject?: string;
  body?: string;
}

/**
 * Documento compartido con la comunidad o con una propiedad.
 *
 * El antiguo campo `isNew: boolean` era GLOBAL — un único flag para todos
 * los usuarios, así que cuando uno lo "veía" quedaba marcado como visto
 * para todos. Eliminado: el estado de lectura ahora se resuelve por
 * usuario vía `ResourceRead` (sourceType='document') — ver
 * `ResourceReadsService.isDocumentRead(userId, id)`.
 */
export interface Document {
  id: string;
  estateId?: string;      // FK → Estate.id
  title: string;
  type: string;
  date: string;
  size: string;
  targetPropertyId?: string | null; // null = visible a toda la finca; si no, solo esa propiedad + gestión
  /** Carpeta de la biblioteca en la que está (solo lectura; null = raíz). */
  folderName?: string | null;
}

export interface AccountingEstate {
  id: string;
  administratorId: string;
  name: string;
  type: EstateType;
  balance: number;
  income: number;
  expenses: number;
  reserve: number;
  reserveTarget: number;
  delinquency: number;
  units: number;
  address?: string;
  streetNumber?: string;
  location?: string;
  catastroFacadeUrl?: string | null;
  iban?: string;
}

/** Naturaleza de la cuenta: en qué lado del balance o de resultados se presenta. */
export type AccountNature = 'asset' | 'liability' | 'equity' | 'income' | 'expense';

export interface ChartAccount {
  id: string;
  estateId: string;         // catálogo por finca — no se comparte entre fincas
  code: string;              // código del plan contable (único por finca)
  name: string;             // nombre completo ('Reparaciones y conservación')
  shortName?: string | null; // nombre corto para tablas ('Reparac. y conservac.')
  /** Etiqueta de display '628 · Suministros', calculada por el backend. */
  label?: string;
  nature?: AccountNature;
  parentId?: string | null;
  level?: number;
  /** false = cuenta agrupadora (p. ej. 572): los apuntes van a sus subcuentas. */
  postable?: boolean;
  /** Cuenta de la plantilla de comunidades: no se borra ni cambia de código. */
  system?: boolean;
  /** Papel fijo en la contabilidad automática; con papel no se puede archivar. */
  systemRole?: string | null;
  requiresProperty?: boolean;
  requiresSupplier?: boolean;
  allowsCostCentre?: boolean;
  archivedAt?: string | null;
}

// ── Cobros (partida doble, fase 5) ──────────────────────────────────────

/** Un movimiento de la partida abierta de un recibo: emisión, cobro, devolución, anulación. */
export interface ReceiptMovement {
  date: string;
  entryNumber: number;
  fiscalYear: number;
  /** Origen del asiento: receipt_issue, collection, remesa_collection, receipt_return… */
  sourceType: string;
  concept: string;
  debit: number;
  credit: number;
  /** Lo que el recibo debe tras este movimiento. */
  balance: number;
  method: PayMethod | null;
  returnCode: string | null;
  returnReason: string | null;
  /** Solo para gestión: el cobro sobre el que se puede actuar. */
  collectionId: string | null;
  /** El cobro sigue vigente: se puede deshacer o devolver. */
  collectionActive: boolean;
  /** Cobro de una remesa: se devuelve desde la remesa. */
  fromRemesa: boolean;
}

export interface ReceiptHistory {
  receiptId: string;
  no: string;
  amount: number;
  outstanding: number;
  status: ReceiptStatus;
  movements: ReceiptMovement[];
}

/** Lo que debe una propiedad y lo que tiene a favor (anticipo). */
export interface PropertyAccount {
  propertyId: string;
  pending: number;
  advance: number;
  /** pending − advance: negativo si la propiedad tiene saldo a favor. */
  balance: number;
  openReceipts: { id: string; no: string; concept: string; amount: number; outstanding: number; status: ReceiptStatus; dueDate: string | null; originYear: number }[];
}

/** Ingreso en el banco que todavía no se sabe de quién es (cuenta 555). */
export interface SuspenseItem {
  id: string;
  date: string;
  amount: number;
  concept: string;
  bankAccountId: string;
  bankAccountAlias: string;
  applied: number;
  remaining: number;
  applications: { id: string; propertyId: string; amount: number; date: string }[];
}

// ── Ficheros de devoluciones del banco (pain.002 / camt.054) ─────────────

export type ReturnFileItemStatus = 'matched' | 'unmatched' | 'applied' | 'already_returned' | 'failed';

export const RETURN_FILE_ITEM_STATUS_LABELS: Record<ReturnFileItemStatus, string> = {
  matched: 'Lista para aplicar',
  unmatched: 'Sin emparejar',
  applied: 'Contabilizada',
  already_returned: 'Ya estaba devuelta',
  failed: 'No se pudo aplicar',
};

export interface ReturnFileItem {
  id: string;
  seq: number;
  endToEndId: string | null;
  amount: number | null;
  date: string | null;
  returnCode: string | null;
  returnReason: string | null;
  feeAmount: number | null;
  status: ReturnFileItemStatus;
  error: string | null;
  /** La línea de remesa emparejada, si la hay. */
  line: { id: string; owner: string; unit: string; receiptNo: string; remesaConcept: string; amount: number } | null;
}

export interface ReturnFile {
  id: string;
  format: 'pain002' | 'camt054';
  fileName: string;
  createdAt: string;
  lastAppliedAt: string | null;
  counts: Record<ReturnFileItemStatus, number>;
  items: ReturnFileItem[];
  /** El mismo fichero ya se había subido: es el mismo registro. */
  duplicate?: boolean;
  /** Resultado de la última aplicación. */
  summary?: { applied: number; alreadyReturned: number; failed: number };
}

/** Motivos de devolución SEPA más habituales (ISO 20022, ExternalReturnReason1Code). */
export const SEPA_RETURN_CODES: { code: string; label: string }[] = [
  { code: 'AM04', label: 'Fondos insuficientes' },
  { code: 'MD06', label: 'Devolución solicitada por el deudor' },
  { code: 'MS02', label: 'Motivo no especificado por el deudor' },
  { code: 'AC04', label: 'Cuenta cancelada' },
  { code: 'AC01', label: 'IBAN incorrecto' },
  { code: 'MD01', label: 'Sin mandato válido' },
  { code: 'MS03', label: 'Motivo no especificado por el banco' },
  { code: 'SL01', label: 'Servicio específico del banco del deudor' },
];

/** Cuenta bancaria de la comunidad (subcuenta 572xxxx del plan). */
export interface BankAccount {
  id: string;
  alias: string;
  accountCode: string;
  /** Solo enmascarado ('ES91 ···· 1332'): el IBAN completo nunca sale del backend. */
  ibanMasked: string | null;
  bic: string | null;
  bankName: string | null;
  isDefault: boolean;
  isReserveAccount: boolean;
  openedOn: string | null;
  closedAt: string | null;
  /** Saldo contable en euros (debe − haber). */
  balance: number;
}

export interface AccountingSettings {
  /** Fecha de inicio contable (AAAA-MM-DD). */
  cutoverDate: string;
  /** Fondo de reserva que heredan los ejercicios nuevos. */
  defaultReserveMode: ReserveMode;
  defaultReserveSharePct: string | null;
  /** Regla de la dotación al cierre que heredan los ejercicios nuevos (fase 11). */
  defaultReserveAllocationRule: ReserveAllocationRule | null;
  defaultReserveAllocationValue: string | null;
  /** Repercutir al propietario la comisión de una devolución con un recibo de gastos. */
  returnFeeRecharge: boolean;
  firstEntryDate: string | null;
  hasOpeningEntry: boolean;
  cutoverEditable: boolean;
  /** Cuándo se confirmó "esta finca no tiene saldos previos" (fase 9) — null si no se confirmó. */
  noPriorBalancesConfirmedAt: string | null;
}

// ── Saldos iniciales (fase 9 de doc/contabilidad/roadmap-partida-doble.md) ──

export type OpeningBalanceSetStatus = 'Borrador' | 'Contabilizado' | 'Sustituido';
/** Dónde puede ir la diferencia de cuadre (117 o 120), siempre aceptada explícitamente. */
export type OpeningDifferenceRole = 'reserve_fund' | 'retained';
/** Las 7 cuentas admitidas para un "otro saldo" (555, 117, 120, 121, 4751, 476, 465). */
export type OpeningOtherBalanceRole =
  | 'reserve_fund' | 'retained' | 'prior_losses'
  | 'withholding_payable' | 'social_security_payable' | 'salaries_payable' | 'suspense';

export interface OpeningBankBalance {
  id: string;
  bankAccountId: string;
  bankAccountAlias: string;
  balance: number;
  statementBalance: number | null;
}

export interface OpeningPropertyDebt {
  id: string;
  propertyId: string;
  propertyLabel: string;
  originYear: number;
  concept: string;
  amount: number;
  dueDate: string | null;
}

export interface OpeningPropertyAdvance {
  id: string;
  propertyId: string;
  propertyLabel: string;
  concept: string;
  amount: number;
}

export interface OpeningSupplierInvoiceRow {
  id: string;
  supplierId: string;
  supplierName: string;
  number: string;
  concept: string;
  issueDate: string;
  dueDate: string | null;
  amount: number;
  payableRole: 'suppliers_payable' | 'creditors_payable';
}

export interface OpeningOtherBalanceRow {
  id: string;
  role: OpeningOtherBalanceRole;
  concept: string;
  side: 'debit' | 'credit';
  amount: number;
}

export interface OpeningBalancesView {
  id: string;
  status: OpeningBalanceSetStatus;
  difference: number | null;
  differenceRole: OpeningDifferenceRole | null;
  differenceAccepted: boolean;
  postedAt: string | null;
  entryId: string | null;
  /** Si no es null, este set es una corrección: contabilizarlo revierte y reemplaza al que sustituye. */
  supersedesId: string | null;
  bankBalances: OpeningBankBalance[];
  propertyDebts: OpeningPropertyDebt[];
  propertyAdvances: OpeningPropertyAdvance[];
  supplierInvoices: OpeningSupplierInvoiceRow[];
  otherBalances: OpeningOtherBalanceRow[];
}

export interface OpeningValidateResult {
  debit: number;
  credit: number;
  difference: number;
  bankMismatches: {
    bankAccountId: string;
    bankAccountAlias: string;
    entered: number;
    statementBalance: number;
  }[];
}

// Cuerpo de PUT /opening-balances — sin `id`: el backend reemplaza todas las filas de una vez.
export interface OpeningBankBalanceInput { bankAccountId: string; balance: number; }
export interface OpeningPropertyDebtInput { propertyId: string; originYear: number; concept: string; amount: number; dueDate?: string; }
export interface OpeningPropertyAdvanceInput { propertyId: string; concept: string; amount: number; }
export interface OpeningSupplierInvoiceInput {
  supplierId: string;
  number: string;
  concept: string;
  issueDate: string;
  dueDate?: string;
  amount: number;
  payableRole?: 'suppliers_payable' | 'creditors_payable';
}
export interface OpeningOtherBalanceInput { role: OpeningOtherBalanceRole; concept: string; side: 'debit' | 'credit'; amount: number; }

export interface SaveOpeningDraftPayload {
  bankBalances: OpeningBankBalanceInput[];
  propertyDebts: OpeningPropertyDebtInput[];
  propertyAdvances: OpeningPropertyAdvanceInput[];
  supplierInvoices: OpeningSupplierInvoiceInput[];
  otherBalances: OpeningOtherBalanceInput[];
}

export interface Supplier {
  id: string;
  administratorId: string;
  estateId: string;         // catálogo por finca — no se comparte entre fincas
  name: string;
  taxIdCountry?: TaxIdCountry;       // país del CIF/NIF/equivalente
  taxId?: string;                    // CIF, NIF de autónomo, etc.
  vatNumber?: string;                // VAT comunitario (opcional, para facturación cross-border)
  category: string;
  email?: string;
  phone?: string;
  /** Persona de contacto en el proveedor. */
  contactName?: string | null;
  iban?: string;
  status: 'Activo' | 'Baja';        // baja lógica — nunca se borra (facturas/incidencias ya vinculadas)
  lastInvoice: string;
  lastAmount: number;
  ytdSpend: number;
  pendingInvoices: number;
  /** true si tiene algún contrato o documento a menos de 30 días de vencer (o ya vencido) — mismo umbral que el feed de Alertas. */
  hasExpiringSoon: boolean;
  /** Fuera del modelo 347 por el art. 33.5 del RGAT (suministros y seguros de elementos comunes). */
  excludedFrom347?: boolean;
}

/** Registrada/Parcial/Pagada se derivan de lo que queda por pagar; Anulada es final. */
export type SupplierInvoiceStatus = 'Registrada' | 'Parcial' | 'Pagada' | 'Anulada';

/** Clave de la retención para los modelos 111 y 190. */
export type WithholdingKey = 'G_profesional' | 'A_trabajo' | 'other';

export const WITHHOLDING_KEY_LABELS: Record<WithholdingKey, string> = {
  G_profesional: 'Actividad profesional (G)',
  A_trabajo: 'Rendimientos del trabajo (A)',
  other: 'Otra',
};

export interface SupplierInvoiceLine {
  lineNo: number;
  accountId: string;
  accountCode: string;
  accountName: string;
  costCentreId: string | null;
  costCentreName: string | null;
  description: string | null;
  baseAmount: number;
  /** Base más su parte del IVA: lo que se carga en la cuenta de gasto. */
  amount: number;
}

/** Factura de proveedor contabilizada: no se edita, se anula y se registra otra. */
export interface SupplierInvoice {
  id: string;
  supplierId: string;
  supplierName: string;
  number: string;
  concept: string;
  issueDate: string;
  receivedDate: string;
  dueDate: string | null;
  baseAmount: number;
  vatRatePct: number;
  vatAmount: number;
  withholdingRatePct: number;
  withholdingAmount: number;
  withholdingKey: WithholdingKey | null;
  total: number;
  /** total − retención: lo que se paga al proveedor. */
  payable: number;
  payableAccount: '400' | '410';
  status: SupplierInvoiceStatus;
  outstanding: number;
  cancelReason: string | null;
  fileName?: string | null;
  lines: SupplierInvoiceLine[];
}

export interface SupplierPayment {
  id: string;
  supplierId: string;
  supplierName: string;
  date: string;
  amount: number;
  method: PayMethod;
  bankAccountAlias: string | null;
  notes: string | null;
  status: 'Vigente' | 'Deshecho';
  undoReason: string | null;
  invoices: { invoiceId: string; number: string; amount: number }[];
}

/** Mayor del proveedor: sus apuntes en la 400/410. El saldo es lo que se le debe. */
export interface SupplierLedger {
  supplierId: string;
  balance: number;
  movements: {
    date: string;
    entryNumber: number;
    fiscalYear: number;
    sourceType: string;
    concept: string;
    accountCode: string;
    invoiceNumber: string | null;
    debit: number;
    credit: number;
    balance: number;
  }[];
}

/// "Tácita" = tácita reconducción (renovación automática salvo aviso en contrario) — término legal español habitual en contratos de mantenimiento de comunidades.
export type SupplierContractRenewalType = 'manual' | 'tacita';

/** Sin campo `status` persistido en backend — se deriva SIEMPRE al leer comparando `endDate` con hoy. Nunca guardar este valor ni asumir que sigue vigente tras el momento en que llegó. */
export type SupplierContractStatus = 'Programado' | 'Activo' | 'PorVencer' | 'Vencido' | 'Cancelado';

export interface SupplierContract {
  id: string;
  supplierId: string;
  estateId: string;
  serviceType: string;
  /** Nº de contrato o de póliza (seguros). */
  contractNumber?: string | null;
  startDate: string;
  endDate?: string | null;
  renewalType: SupplierContractRenewalType;
  costAmount?: number | null;
  costFrequency?: 'MONTHLY' | 'QUARTERLY' | 'SEMIANNUAL' | 'ANNUAL' | 'ONE_OFF' | 'OTHER' | null;
  currency?: string;
  reviewFrequency?: string | null;      // sugerida por categoría en el frontend, nunca una lista cerrada
  cancelledAt?: string | null;
  cancelledReason?: string | null;
  notes?: string | null;
  status: SupplierContractStatus;       // calculado por el backend en cada respuesta
  createdAt: string;
  updatedAt: string;
}

/** Contrato de la finca con su proveedor y los días hasta el vencimiento (`GET estates/:id/contracts`). */
export interface EstateContract extends SupplierContract {
  supplier: { id: string; name: string; category: string };
  /** Negativo si ya venció; null si no tiene fecha de fin. */
  daysLeft: number | null;
  /** Coste anualizado con la regla única del backend; null si es puntual, «otro» o no tiene importe. */
  annualCost?: number | null;
  /** `annualCost` / 12, redondeado a céntimos; null cuando no hay coste anual. */
  monthlyCost?: number | null;
  /** Nº de documentos adjuntos al contrato. */
  documentCount?: number;
}

/** Una renovación registrada de un contrato (`GET estates/:id/contracts/renewals`). */
export interface ContractRenewal {
  id: string;
  contractId: string;
  serviceType: string;
  supplier: { id: string; name: string; category: string };
  /** Fecha en que se renovó. */
  renewedAt: string;
  previousEndDate?: string | null;
  newEndDate: string;
  costAmount?: number | null;
  costFrequency?: SupplierContract['costFrequency'];
  currency?: string;
  annualCost?: number | null;
  /** `manual` = la registró el gestor; `tacita` = renovación automática. */
  kind: SupplierContractRenewalType;
  notes?: string | null;
}

export type SupplierDocumentType = 'Contrato' | 'Seguro' | 'Certificado' | 'Presupuesto' | 'Otro';

export interface SupplierDocument {
  id: string;
  supplierId: string;
  contractId?: string | null;
  documentType: SupplierDocumentType;
  title: string;
  fileName: string;
  mimeType: string;
  expiresAt?: string | null;            // independiente de SupplierContract.endDate — un seguro/certificado vence por su cuenta
  createdAt: string;
}

export interface SupplierPerformance {
  totalIssuesAssigned: number;
  resolvedIssues: number;
  openIssues: number;
}

/** Personal contratado directamente por la finca (portero, seguridad, socorrista...) — relación laboral, no mercantil. */
export interface StaffMember {
  id: string;
  estateId: string;
  administratorId: string;
  fullName: string;
  position: string;
  nationalId?: string | null;
  email?: string | null;
  phone?: string | null;
  contractType: 'Indefinido' | 'Temporal' | 'Obra y servicio' | 'Autónomo';
  startDate: string;
  endDate?: string | null;
  schedule?: string | null;
  monthlyCost?: number | null;
  status: 'Activo' | 'Baja';
  createdAt: string;
}

export interface StaffDocument {
  id: string;
  staffMemberId: string;
  title: string;
  fileName: string;
  mimeType: string;
  createdAt: string;
}

/** Subconjunto público — lo que ve un propietario (rol C) en el directorio de su finca. */
export interface StaffDirectoryEntry {
  id: string;
  fullName: string;
  position: string;
  phone?: string | null;
  email?: string | null;
  schedule?: string | null;
}

export interface BudgetItem {
  id: string;
  accountId: string;
  code: string;
  category: string;
  fiscalYear: number;
  budgeted: number;
  executed: number;
  /** Solo poblado por GET /budget/analysis — ejecutado del año anterior, referencia de "liquidación del ejercicio". */
  executedPriorYear?: number;
}

/** Dimensión transversal de presupuestación (piscina, ascensor portal A...), independiente del plan contable — NO sustituye a ChartAccount. */
export interface CostCentre {
  id: string;
  estateId: string;
  administratorId: string;
  name: string;
  description?: string | null;
  status: 'Activo' | 'Archivado';
  /** Del ejercicio en curso — derivados, nunca almacenados (mismo criterio que Supplier.ytdSpend). */
  budgeted?: number | null;
  executed?: number;
}

export interface CostCentreBudget {
  id: string;
  costCentreId: string;
  costCentreName: string;
  fiscalYear: number;
  budgeted: number;
  executed: number;
  executedPriorYear?: number;
}

export type FiscalYearStatus = 'Abierto' | 'Cerrado';

/** `id: null` = ejercicio virtual todavía sin fila propia (ver FiscalYearsService.getFiscalYear en backend) — nunca escrito hasta la primera aprobación/cierre. */
export interface FiscalYear {
  id: string | null;
  estateId: string;
  year: number;
  startDate: string;
  endDate: string;
  status: FiscalYearStatus;
  approvedAt?: string | null;
  approvedNote?: string | null;
  closedAt?: string | null;
  closedByUserId?: string | null;
  /** Solo si se reabrió tras haberse cerrado (fase 11). */
  reopenedAt?: string | null;
  reopenReason?: string | null;
  /** Fondo de reserva del ejercicio (ADR, D3). */
  reserveMode?: ReserveMode;
  /** Porcentaje de cada cuota ordinaria que va a la 117 (Decimal en string). */
  reserveSharePct?: string | null;
  /** Regla de la dotación al cierre (modos "dotación al cierre" y "ambos", fase 11). */
  reserveAllocationRule?: ReserveAllocationRule | null;
  /** Importe fijo en euros, o porcentaje del resultado, según la regla (Decimal en string). */
  reserveAllocationValue?: string | null;
}

/** Cómo se dota el fondo de reserva. */
export type ReserveMode = 'none' | 'receipt_share' | 'year_end_allocation' | 'both';

/** Regla de la dotación al cierre (fase 11). */
export type ReserveAllocationRule = 'fixed_amount' | 'pct_of_result' | 'top_up_to_legal_minimum';

/** Bloqueo o aviso de `GET .../close-preconditions` (fase 11). */
export interface ClosePreconditionItem {
  code: string;
  message: string;
}

export interface ClosePreconditionsView {
  year: number;
  blockers: ClosePreconditionItem[];
  warnings: ClosePreconditionItem[];
  canClose: boolean;
}

/** Destinos admitidos para la aplicación del resultado (D15) — la devolución por coeficiente queda fuera de alcance. */
export type ResultApplicationTarget = 'retained' | 'reserve_fund';

export interface ApplyResultOutcome {
  entryId: string;
  appliedAmount: number;
  target: ResultApplicationTarget;
}

export interface BudgetAnalysis {
  fiscalYear: number;
  budget: BudgetItem[];
  costCentreBudget: CostCentreBudget[];
  reserveLegalMinimum: number | null;
}

export interface DebtorReminders {
  l1: boolean;
  l2: boolean;
  bf: boolean;
}

export type GestionType = 'Llamada' | 'Email' | 'Carta amistosa' | 'Carta formal' | 'Burofax' | 'Acción judicial';

/**
 * Acción de gestión sobre un moroso. Antes se llamaba `GestionEntry` y
 * vivía embebido dentro del array `Debtor.history`. Ahora es una tabla
 * independiente con `debtorId` FK — permite paginación, ordenación,
 * borrado individual y consultas cross-debtor para KPIs del admin.
 */
export interface DebtorAction {
  id: string;
  debtorId: string;                // FK a Debtor.id
  type: GestionType;
  date: string;
  note: string;
  result: string;
  author: string;                  // legacy display name
  authorUserId?: string;           // FK al admin que ejecutó la gestión
  onBehalfOfUserId?: string | null; // si actuó en nombre de otro
}

/** @deprecated alias de compatibilidad. Usar `DebtorAction`. */
export type GestionEntry = DebtorAction;

export interface Debtor {
  id: string;
  administratorId: string;
  estateId: string;
  propertyId: string | null;
  name: string;             // titular principal de la propiedad — resuelto por el backend (PropertyMembership), 'Sin titular' si no hay ninguno vinculado
  property: string;         // ref/escalera/piso/puerta formateados — ver DebtorsService.formatPropertyLabel
  amount: number;
  interest: number;
  monthsOverdue: number;
  oldest: string;
  lastContact: string | null;
  reminders: DebtorReminders;
  step: string;
  // El histórico (`history: GestionEntry[]`) ha sido EXTRAÍDO a la tabla
  // `debtor_actions`. Los componentes lo obtienen vía
  // `DebtorsService.listActionsForDebtor(debtorId)`.
}

/**
 * Saldo de UN vecino — a diferencia de `Debtor` (solo quien ya tiene fila
 * en esa tabla), cubre TODAS las propiedades de la finca, recalculado en
 * vivo desde `AccountingReceipt` (ver `DebtorsService.computeBalances` en
 * backend). `debtorId` es null cuando la propiedad tiene deuda pero
 * todavía nadie inició una gestión de cobro sobre ella.
 */
export interface NeighbourBalance {
  propertyId: string;
  property: { ref: string | null; staircase: string | null; floor: string | null; door: string | null };
  titular: string | null;
  email: string | null;
  phone: string | null;
  balance: number;
  /** Anticipo sin aplicar (430 acreedora sin recibo) — aparte de `balance`, nunca restado. */
  advance: number;
  isUpToDate: boolean;
  debtorId: string | null;
  monthsOverdue: number;
  step: string | null;
  lastContact: string | null;
  reminderL1: boolean;
  reminderL2: boolean;
  reminderBf: boolean;
}

// ── Payment agreements (acuerdos de pago) ──────────────────────────────
//
// Antes el "acuerdo de pago" del panel de morosidad era puramente un
// cálculo en memoria (`acuerdoPlan` computed a partir de sliders) que se
// descartaba al cerrar el drawer — el botón "Confirmar acuerdo" ni
// siquiera lo guardaba (llamaba por error al mismo método que registra
// una gestión genérica). Ahora el acuerdo y sus cuotas son entidades
// persistentes: al confirmar se generan todas las líneas de una vez, y
// cada cuota se puede marcar pagada individualmente y enlazar a un recibo
// real — "cobrar conforme al plan" exige poder saber qué cuota concreta
// está vencida o pagada, no solo el total.

export type PaymentAgreementStatus = 'active' | 'completed' | 'breached' | 'cancelled';

export interface PaymentAgreement {
  id: string;
  debtorId: string;                  // FK → Debtor.id
  totalAmount: number;                // amount + interest del deudor al firmar
  downPaymentAmount: number;           // importe de la entrada (0 si no hay)
  installmentsCount: number;
  firstDueDate: string;               // YYYY-MM-DD
  status: PaymentAgreementStatus;
  signedAt: string;
  createdByUserId: string;
  cancelledAt?: string | null;
  cancelledReason?: string;
}

export interface PaymentAgreementInstallment {
  id: string;
  agreementId: string;               // FK → PaymentAgreement.id
  seq: number;                        // 0 = entrada, 1..N = cuotas
  dueDate: string;
  amount: number;
  paidAt?: string | null;
  receiptId?: string | null;          // FK → AccountingReceipt.id cuando se cobra
}

// ── Intereses de demora (fase 10 de doc/contabilidad/roadmap-partida-doble.md) ──

/** Tipo de interés vigente en la finca — una vigencia usada nunca se edita, se cierra y se abre una nueva. */
export interface LatePaymentInterestPolicy {
  id: string;
  estateId: string;
  annualRatePct: number;
  graceDays: number;
  validFrom: string;
  /** null = sigue vigente. */
  validTo: string | null;
  meetingReference: string | null;
  createdByUserId: string;
  createdAt: string;
}

export interface LateInterestSegment {
  from: string;
  /** Exclusivo. */
  to: string;
  days: number;
  annualRatePct: number;
  principal: number;
  amount: number;
}

export interface LateInterestPreview {
  debtReceiptNo: string;
  /** null si todavía no pasó la carencia. */
  interestStart: string | null;
  segments: LateInterestSegment[];
  total: number;
}

export interface LateInterestAccrueResult extends LateInterestPreview {
  interestReceiptId: string;
}

/** Una fila del certificado de deuda (art. 9.1.e LPH) — también se reutiliza para elegir sobre qué recibo liquidar intereses. */
export interface DebtCertificatePendingReceipt {
  id: string;
  no: string;
  period: string;
  concept: string;
  amount: number;
  outstanding: number;
  /** Año de la deuda de origen — en un recibo de intereses, el de la deuda que liquida, no el de su propia emisión. */
  originYear: number;
  isInterest: boolean;
  status: ReceiptStatus;
  dueDate: string | null;
}

export interface DebtCertificate {
  issuedAt: string;
  issuedByUserId: string;
  legalBasis: string;
  estate: { id: string; name: string; cif: string | null };
  property: { id: string; ref: string | null; staircase: string | null; floor: string | null; door: string | null };
  pendingReceipts: DebtCertificatePendingReceipt[];
  principal: number;
  interest: number;
  totalDebt: number;
  activeAgreement: PaymentAgreement | null;
  isDebtFree: boolean;
}

// ── Accounting Receipts ───────────────────────────────────────────────────

/**
 * Estado de cobro del recibo. Parcial y Anulado no se ponen a mano: salen de
 * los cobros parciales y de la anulación (contraasiento de la emisión).
 */
export type ReceiptStatus = 'Pagada' | 'Pendiente' | 'Devuelto' | 'Parcial' | 'Anulado';

/** Tipo de recibo (decide la cuenta de ingreso de su emisión). */
export type ReceiptKind =
  | 'cuota_ordinaria'
  | 'derrama'
  | 'fondo_reserva'
  | 'saldo_anterior'
  | 'intereses_demora'
  | 'gastos_devolucion'
  | 'otros';

export const RECEIPT_KIND_LABELS: Record<ReceiptKind, string> = {
  cuota_ordinaria: 'Cuota ordinaria',
  derrama: 'Derrama',
  fondo_reserva: 'Fondo de reserva',
  saldo_anterior: 'Saldo anterior',
  intereses_demora: 'Intereses de demora',
  gastos_devolucion: 'Gastos de devolución',
  otros: 'Otros',
};

/** Tipos que se pueden emitir a mano (el resto salen de otros procesos). */
export const MANUAL_RECEIPT_KINDS: ReceiptKind[] = [
  'cuota_ordinaria',
  'derrama',
  'fondo_reserva',
  'gastos_devolucion',
  'otros',
];
export type PayMethod = 'Domiciliación' | 'Transferencia' | 'Efectivo' | 'Pago en oficina' | 'Bizum' | 'Devolución' | 'Pendiente';

export interface AccountingPeriod {
  key: string;       // '2026-05'
  label: string;     // 'Mayo 2026'
  mon: string;       // 'may'
  current?: boolean;
}

/**
 * Recibo emitido — entidad canónica única (antes existía también un
 * `Receipt` simple para el rol C, ya eliminado).
 *
 * Cumple con el patrón FK viva + snapshot inmutable en documentos
 * fiscales (Apéndice B). Contiene tanto los datos "vivos" de display
 * como los snapshots congelados al emitir para regenerar el PDF idéntico
 * años después.
 *
 * Proyecciones:
 *  - Rol C: subset de campos (month=period, amount, status, dueDate=date)
 *    filtrados por `ownerUserId=me`.
 *  - Rol B: acceso a todos los campos, filtrados por finca/periodo.
 */
export interface AccountingReceipt {
  id: string;
  no: string;
  periodKey: string;                 // 'YYYY-MM' — PK natural del periodo
  period: string;                    // label 'Mayo 2026'
  // ── Datos vivos (display / búsqueda) ────────────────────────────────
  owner: string;                     // legacy display label — se mantiene mientras la UI lee strings
  unit: string;
  propertyId?: string;               // FK → Property.id
  amount: number;
  iban: string;
  mandate: string;                   // legacy — sustituido por mandateId
  concept: string;
  /** Etiqueta en español ('Derrama'); el valor del enum va en `kindCode`. */
  kind: string;
  kindCode?: ReceiptKind;
  status: ReceiptStatus;
  /** Lo que queda por cobrar (0 si está pagado o anulado). */
  outstanding?: number;
  /** Año de la deuda, para el certificado del art. 9.1.e LPH. */
  originYear?: number;
  cancelReason?: string | null;
  cancelledAt?: string | null;
  issuedAt?: string | null;           // explicit emission timestamp, unknown for legacy
  date: string;                      // fecha de emisión / cobro / devolución según status
  dueDate?: string;                  // fecha de vencimiento del cobro (necesario para rol C)
  method: PayMethod | string;
  manual: boolean;
  returnCode?: string;
  returnReason?: string;
  // ── FK viva ─────────────────────────────────────────────────────────
  ownerUserId?: string;
  mandateId?: string;
  // ── Snapshot inmutable al emitirse (legal/fiscal) ───────────────────
  ownerNameSnapshot?: string;
  ownerTaxIdSnapshot?: string;
  ownerTaxIdCountrySnapshot?: TaxIdCountry;
  ibanSnapshot?: string;
  // ── Justificante de pago subido por el propietario (rol C) ──────────
  proofFileName?: string | null;
}

/**
 * Alias de compatibilidad para el nombre corto usado en el rol C.
 * Todo componente que importe `Receipt` sigue funcionando — la entidad
 * subyacente es `AccountingReceipt`. Se puede retirar cuando todos los
 * imports migren al nombre canónico.
 */
export type Receipt = AccountingReceipt;

// ── Imports (migración autoservicio desde Gesfincas/genérico, rol B) ───────
//
// Ver plan sprightly-snacking-yao.md — Fase 2: solo estado actual
// (Property/ExternalOwner), scope='historical_accounting' existe como valor
// de enum en la base de datos pero todavía no tiene lógica de commit.

export type ImportSourcePlatform = 'GESFINCAS_NET' | 'GENERIC';
export type ImportScope = 'current_state' | 'historical_accounting';
export type ImportBatchStatus =
  | 'uploading' | 'validating' | 'ready' | 'importing' | 'completed' | 'failed' | 'rolled_back';
export type ImportEntityType = 'property' | 'owner' | 'movement' | 'receipt' | 'remesa' | 'opening-balance' | 'supplier-invoice';

/** Campo destino de un preset de mapeo — `headerGuesses` solo sirve para pre-rellenar el `<select>`, nunca se asume a ciegas. */
export interface ColumnPreset {
  targetField: string;
  label: string;
  required: boolean;
  headerGuesses: string[];
}

export interface ImportBatch {
  id: string;
  estateId: string;
  administratorId: string;
  sourcePlatform: ImportSourcePlatform;
  scope: ImportScope;
  status: ImportBatchStatus;
  rawFileKey: string | null;
  mapping: Record<string, string> | null;
  summary: unknown | null;
  createdByUserId: string;
  createdAt: string;
  completedAt: string | null;
}

export interface ImportValidationSummary {
  entityType: ImportEntityType;
  totalRows: number;
  okRows: number;
  errorCount: number;
  warningCount: number;
  errors: { rowNumber: number; errors: string[] }[];
  warnings: { rowNumber: number; warnings: string[] }[];
}

/** Respuesta de commit — el mismo resumen de validate() extendido con los contadores reales de la escritura. */
export interface ImportCommitSummary extends ImportValidationSummary {
  committed: {
    createdCount: number;
    skippedCount: number;
    skippedReasons: { rowNumber: number; reason: string }[];
  };
}

// ── Remesas ───────────────────────────────────────────────────────────────
export type SepaScheme = 'CORE' | 'B2B';
export type RemesaStatus = 'Borrador' | 'Presentada' | 'Cobrada' | 'Con devoluciones' | 'Anulada';
/**
 * Secuencia SEPA del cobro (EPC Rulebook §4.3):
 *  - FRST: primer cobro contra el mandato.
 *  - RCUR: cobros recurrentes posteriores.
 *  - OOFF: cobro único (mandato oneOff — no vuelve a usarse).
 *  - FNAL: último cobro previsto contra el mandato (se cerrará después).
 *
 * Antes solo se soportaba FRST/RCUR.
 */
export type MandateSeq = 'FRST' | 'RCUR' | 'OOFF' | 'FNAL';

export interface RemesaCandidate {
  id: string;
  owner: string;
  unit: string;
  iban: string | null;
  mandate: boolean;
  seq: MandateSeq;
  amount: number;
  isNew?: boolean;
}

export interface RemesaHistoryItem {
  id: string;
  period: string;
  periodKey: string;
  scheme: string;
  count: number;
  amount: number;
  presented: string;
  charge: string;
  status: RemesaStatus;
  charged: number;
  returned: number;
  pending: number;
  returnedAmount: number;
}

export interface RemesaLine {
  id: string;
  owner: string;                   // legacy display label
  unit: string;
  iban: string;                    // legacy display label
  mandate: string;                 // legacy display label
  seq: string;
  amount: number;
  /** Rechazado: el banco no llegó a cargarlo (sin dinero de por medio). */
  status: 'Cobrado' | 'Pendiente' | 'Devuelto' | 'Rechazado';
  returnCode?: string;
  returnReason?: string;
  // ── FK viva ────────────────────────────────────────────────────────
  ownerUserId?: string;
  mandateId?: string;
  receiptId?: string;
  // ── Snapshot inmutable (legal/SEPA): el XML pain.008 ya enviado al
  // banco contiene estos datos exactos; el histórico no debe alterarse. ─
  ownerNameSnapshot?: string;
  ownerTaxIdSnapshot?: string;
  ownerTaxIdCountrySnapshot?: TaxIdCountry;
  ibanSnapshot?: string;
}

// ── Privacidad y notificaciones por membresía de propiedad ──────────────
// Un mismo usuario puede tener varias propiedades en fincas distintas y
// querer comportarse distinto en cada una — igual que `nickname`/
// `isPrimaryContact`, que ya viven en la membresía y no en `User`.
export type DirectMessagePolicy = 'nobody' | 'neighbors' | 'anyone_linked';
export type NotificationSetting = 'none' | 'push_only' | 'email_only' | 'email_push';
/** Cómo me ven otros usuarios en mensajería/listados dentro de esta propiedad. */
export type DisplayNamePolicy = 'full_name' | 'alias' | 'address';

export interface MembershipSettings {
  visibleInDirectory: boolean;
  showPhoneInDirectory: boolean;
  showEmailInDirectory: boolean;
  visibleInBookings: boolean;
  allowDirectMessages: DirectMessagePolicy;
  displayNamePolicy: DisplayNamePolicy;
  displayAlias?: string | null;
  notifyIssues: NotificationSetting;
  notifyReceipts: NotificationSetting;
  notifyCommunications: NotificationSetting;
  notifyBookings: NotificationSetting;
  notifyDirectMessages: NotificationSetting;
}

// ── Mensajería directa (usuarios de una misma finca) ─────────────────────

export interface DirectMessageContact {
  userId: string;
  displayName: string;
  estateId: string;
  /** Conversación previa con este contacto, aunque la haya eliminado de su lista: su historial se carga al abrirlo. */
  conversationId?: string | null;
}

export interface ConversationSummary {
  id: string;
  estateId?: string | null;
  lastMessageSenderId?: string | null;
  otherUserId: string;
  otherDisplayName: string;
  lastMessagePreview: string;
  lastMessageAt: string;
  unreadCount: number;
}

export interface DirectMessageAttachment {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
}

export interface DirectMessage {
  attachments?: DirectMessageAttachment[];
  id: string;
  conversationId: string;
  senderId: string;
  text: string;
  createdAt: string;
  /** Fecha de la última edición del texto; null/ausente = nunca editado. */
  editedAt?: string | null;
  /** Fecha del borrado; el mensaje sigue en el hilo pero sin texto ni adjuntos. */
  deletedAt?: string | null;
  /** Solo en mensajes propios: el otro participante ya abrió la conversación. */
  readByRecipient?: boolean;
}

/** Equivalente de MembershipSettings para usuarios sin PropertyMembership (rol A/B) — ajuste global, no por propiedad. */
export interface UserMessagingSettings {
  allowDirectMessages: DirectMessagePolicy;
  displayNamePolicy: DisplayNamePolicy;
  displayAlias?: string | null;
}

// ── Inspecciones normativas de elementos comunes ─────────────────────────

export interface Asset {
  id: string;
  estateId: string;
  name: string;
  category: string;
  location?: string | null;
  manufacturer?: string | null;
  serialNumber?: string | null;
  notes?: string | null;
}

/** Catálogo de tipos de inspección legalmente exigidos — global (sembrado) o personalizado de una finca. */
export interface InspectionType {
  id: string;
  code: string;
  name: string;
  legalBasis?: string | null;
  requiresOca: boolean;
}

export type InspectionStatus = 'Planificada' | 'Citada' | 'Realizada' | 'Desfavorable' | 'Vencida' | 'Exenta';
export type InspectionOutcome = 'Favorable' | 'Desfavorable';
export type CorrectiveActionStatus = 'Abierta' | 'En progreso' | 'Cerrada' | 'Vencida';

export interface InspectionResult {
  id: string;
  date: string;
  outcome: InspectionOutcome;
  defects?: string | null;
  certificateKey?: string | null;
  cost?: number | null;
  notes?: string | null;
}

export interface CorrectiveAction {
  id: string;
  title: string;
  description?: string | null;
  priority: number;
  dueDate?: string | null;
  status: CorrectiveActionStatus;
  assigneeUserId?: string | null;
  supplierId?: string | null;
}

export interface Inspection {
  id: string;
  estateId: string;
  asset: Asset;
  inspectionType: InspectionType;
  status: InspectionStatus;
  nextDueDate?: string | null;
  appointmentDate?: string | null;
  lastDoneDate?: string | null;
  reminderDaysBefore: number;
  notes?: string | null;
  results: InspectionResult[];
  correctiveActions: CorrectiveAction[];
}

// ── Catastro ─────────────────────────────────────────────────────────────
// Servicios web libres de la Dirección General del Catastro (datos públicos
// de inmuebles: sin titulares, NIF ni valores catastrales — son datos
// protegidos y no se piden). El backend hace de intermediario: normaliza la
// respuesta y controla el cupo de peticiones.

/** Una fila del preview de `previewQuotasByArea` — coeficiente propuesto si se reparte 100% proporcional a m². */
export interface CoefficientAreaPreviewRow {
  propertyId: string;
  ref: string | null;
  type: OwnerPropertyType;
  builtAreaM2: number;
  currentQuota: number | null;
  proposedQuota: number;
}

export interface CoefficientAreaPreview {
  rows: CoefficientAreaPreviewRow[];
  /** Si hay alguna, `rows` viene vacío — no se reparte sobre un subconjunto de la finca. */
  missingArea: { propertyId: string; ref: string | null; type: OwnerPropertyType }[];
}

/** Unidad de una parcela catastral, ya normalizada (lo que el gestor revisa antes de importar). */
export interface CatastroUnit {
  cadastralReference: string;          // 20 caracteres
  type: OwnerPropertyType;             // sugerido a partir del uso catastral, editable
  use: string | null;                  // uso catastral tal cual ("Residencial", "Almacen-Estacionamiento"…)
  viaType: ViaType | null;
  viaName: string | null;
  streetNumber: string | null;
  streetNumberSuffix: string | null;
  block: string | null;
  staircase: string | null;
  floor: string | null;
  door: string | null;
  postalCode: string | null;
  municipality: string | null;
  province: string | null;
  builtAreaM2: number | null;
  participationQuota: number | null;   // % — valor catastral, puede diferir del de la escritura
  /** Ya existe una propiedad de la finca con esa referencia: se omite al importar. */
  alreadyImported: boolean;
}

export interface CatastroLookup {
  source: {
    name: string;                      // "Dirección General del Catastro" — hay que citarla
    parcelReference: string;           // 14 caracteres
    fetchedAt: string;                 // ISO — fecha de acceso, también obligatoria de citar
  };
  units: CatastroUnit[];
  warnings: string[];
}

/** Consulta: o referencia catastral (14/18/20), o dirección completa. */
export type CatastroLookupQuery =
  | { refCat: string }
  | { provincia: string; municipio: string; sigla: string; calle: string; numero: string };

export interface CatastroProvince { code: string; name: string; }
export interface CatastroStreet { sigla: string; name: string; }

export interface CatastroImportResult { created: number; skipped: number; }

// ── Notificaciones (bandeja unificada) ──────────────────────────────────
// Complementa al feed de Alertas (`AlertItem`, derivado al vuelo): esto es
// la bandeja persistida por destinatario que cubre lo que las Alertas no
// cubrían — solicitudes de adhesión/alta, mensajes directos, incidencias,
// juntas cerradas, inspecciones, comunicados urgentes.

export type NotificationCategory = 'adhesion' | 'onboarding' | 'issue' | 'direct_message' | 'inspection' | 'meeting' | 'communication' | 'booking' | 'receipt' | 'billing' | 'task' | 'document';

export interface NotificationItem {
  id: string;
  category: NotificationCategory;
  title: string;
  body: string | null;
  link: string;                        // ruta del frontend, navegar directo con Router
  estateId: string | null;
  propertyId: string | null;
  read: boolean;
  createdAt: string;
}

export interface NotificationSummary {
  unreadNotifications: number;
  unreadMessages: number;
  pendingTasks: number;                // solo roles A/B
}

export interface NotificationPreference {
  category: NotificationCategory;
  emailEnabled: boolean;
}

/// Tareas del administrador (rol B) o de soporte (rol A) — a diferencia de
/// `NotificationItem` (un evento con leído/no leído), esto es un ESTADO
/// derivado al vuelo: no se marca como leído, desaparece solo al resolverse.
export type TaskKind = 'onboarding_requests' | 'adhesion_requests' | 'issues_open' | 'inspections_overdue' | 'inspections_due_soon' | 'corrective_actions_overdue' | 'meetings_to_close';

export interface TaskItem {
  kind: TaskKind;
  estateId: string | null;
  estateName: string | null;
  title: string;
  count: number;
  link: string;
}

// ── Role A despacho context and support mode (odd/tasks/role-a-panel.md S1, S5) ──
/** Despacho (administrator) role A is currently looking at. */
export interface DespachoRef {
  id: string;
  name: string;
}

/** Support session of a Domora staff member on one despacho (`/support-sessions`). */
export interface SupportSession {
  id: string;
  staffUserId: string;
  administratorId: string;
  reason: string;
  ticketRef: string | null;
  startedAt: string;
  expiresAt: string;
  endedAt: string | null;
}
