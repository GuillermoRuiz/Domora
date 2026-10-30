import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import type { InsuranceClaim, Prisma } from '../prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { IssueEventsService } from './issue-events.service';
import {
  IssueWorkflowService,
  type OpenedTask,
  type WorkflowActor,
} from './issue-workflow.service';
import {
  ACTIVE_CLAIM_STATUSES,
  CLAIM_STATUS_LABELS,
  CLAIM_WAIT_REF_TYPE,
  ISSUE_CLOSED_INSURANCE_CLAIM_NOT_ALLOWED,
  canChangeClaimStatus,
  claimStage,
  isClaimStatus,
  isInsuranceCategory,
  isTerminalClaimStatus,
  normalizeClaimText,
  type ClaimStage,
  type ClaimStatus,
} from './insurance-claims';

type Db = Prisma.TransactionClient;

export interface OpenClaimInput {
  issueId: string;
  actor: WorkflowActor;
  /** Aseguradora del directorio de la comunidad (categoría «Seguros»). Sin ella, basta `insurerName`. */
  insurerSupplierId?: string;
  insurerName?: string;
  contractId?: string;
  policyNumber?: string;
  reference?: string;
  contactName?: string;
  contactPhone?: string;
}

export interface UpdateClaimInput {
  issueId: string;
  /** Obligatorio si hay varios siniestros vivos: nunca se infiere cuál. */
  claimId?: string | null;
  actor: WorkflowActor;
  reference?: string;
  status?: ClaimStatus;
  contactName?: string;
  contactPhone?: string;
  policyNumber?: string;
}

export interface ClaimView {
  id: string;
  insurerName: string;
  insurerSupplierId: string | null;
  contractId: string | null;
  policyNumber: string | null;
  reference: string | null;
  status: string;
  stage: ClaimStage;
  openedAt: Date;
  closedAt: Date | null;
  contactName: string | null;
  contactPhone: string | null;
  /** Profesional enviado por la aseguradora (asignación vigente ligada a este siniestro). */
  professional: {
    assignmentId: string;
    supplierId: string | null;
    name: string;
    phone: string | null;
  } | null;
  /** Lo que espera la incidencia de la aseguradora por este siniestro. */
  waiting: { since: Date; dueAt: Date | null } | null;
}

const clean = (value: string | null | undefined): string | null => {
  const text = value?.trim();
  return text ? text : null;
};

/** Identidad de la aseguradora para comparar siniestros: su proveedor del directorio o, si no lo hay, su nombre. */
const insurerKey = (supplierId: string | null, name: string): string =>
  supplierId ?? `name:${normalizeClaimText(name)}`;

/**
 * Siniestro de seguro de una incidencia. Es la ÚNICA operación de dominio para abrirlo y cambiarlo: la usan tanto los
 * efectos `open_claim` / `update_claim` de «Registrar gestión» como `PATCH …/insurance-claims/:id`, y mañana un job de
 * Domora podría llamarla con `actor = ai` sin cambiar el dominio.
 *
 * El siniestro describe solo el expediente del seguro. La próxima actuación es una `AgendaTask`, lo que se espera de la
 * aseguradora un `IssueWait`, el profesional enviado un `IssueProviderAssignment.claimId`, la visita un `SupplierVisit`.
 */
@Injectable()
export class InsuranceClaimsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflow: IssueWorkflowService,
    private readonly events: IssueEventsService,
  ) {}

  /** Siniestros vivos (no terminales) de la incidencia. Un rechazo sigue vivo: puede reconsiderarse. */
  activeClaims(db: Db, issueId: string): Promise<InsuranceClaim[]> {
    return db.insuranceClaim.findMany({
      where: { issueId, status: { in: ACTIVE_CLAIM_STATUSES } },
      orderBy: { openedAt: 'asc' },
    });
  }

  /**
   * El siniestro al que se refiere una operación. Con `claimId`, ese (de esta incidencia). Sin él, el único vivo; si hay
   * varios, se exige `claimId` — nunca se adivina — y si no hay ninguno, falla (salvo `optional`).
   */
  async resolveClaim(
    db: Db,
    issueId: string,
    claimId: string | null | undefined,
    options: { optional?: boolean; allowTerminal?: boolean } = {},
  ): Promise<InsuranceClaim | null> {
    if (claimId) {
      const claim = await db.insuranceClaim.findFirst({
        where: { id: claimId, issueId },
      });
      if (!claim)
        throw new BadRequestException(
          'Ese siniestro no pertenece a esta incidencia.',
        );
      if (!options.allowTerminal && isTerminalClaimStatus(claim.status))
        throw new ConflictException(
          'Ese siniestro ya está cerrado o desistido.',
        );
      return claim;
    }
    const active = await this.activeClaims(db, issueId);
    if (active.length === 1) return active[0];
    if (active.length > 1)
      throw new BadRequestException(
        'Hay varios siniestros abiertos: indica a cuál te refieres (claimId).',
      );
    if (options.optional) return null;
    throw new BadRequestException(
      'No hay ningún siniestro abierto en esta incidencia.',
    );
  }

  async open(
    db: Db,
    input: OpenClaimInput,
  ): Promise<{ claim: InsuranceClaim }> {
    // Con la incidencia bloqueada: un cierre en curso termina antes (y este alta lo verá cerrado) o ve el siniestro nuevo.
    await this.workflow.lockIssue(db, input.issueId);
    const issue = await this.workflow.scope(db, input.issueId);
    this.assertIssueNotClosed(issue.status, 'open');
    const supplier = input.insurerSupplierId
      ? await db.supplier.findFirst({
          where: {
            id: input.insurerSupplierId,
            estateId: issue.estateId,
            status: 'Activo',
          },
          select: { id: true, name: true, category: true },
        })
      : null;
    if (input.insurerSupplierId && !supplier)
      throw new BadRequestException(
        'La aseguradora no existe, está de baja o no es de esta comunidad.',
      );
    if (supplier && !isInsuranceCategory(supplier.category))
      throw new BadRequestException(
        'Ese proveedor no es una aseguradora (categoría «Seguros»).',
      );
    const insurerName = supplier?.name ?? clean(input.insurerName);
    if (!insurerName)
      throw new BadRequestException(
        'Indica la aseguradora (del directorio o por su nombre).',
      );

    let policyNumber = clean(input.policyNumber);
    let contractId: string | null = null;
    if (input.contractId) {
      if (!supplier)
        throw new BadRequestException(
          'La póliza del directorio es de una aseguradora del directorio.',
        );
      const contract = await db.supplierContract.findFirst({
        where: {
          id: input.contractId,
          supplierId: supplier.id,
          estateId: issue.estateId,
        },
        select: { id: true, contractNumber: true },
      });
      if (!contract)
        throw new BadRequestException(
          'Esa póliza no es de la aseguradora indicada.',
        );
      contractId = contract.id;
      policyNumber ??= clean(contract.contractNumber);
    }
    const reference = clean(input.reference);
    await this.assertReferenceFree(db, issue.id, {
      insurerSupplierId: supplier?.id ?? null,
      insurerName,
      reference,
    });

    const claim = await db.insuranceClaim.create({
      data: {
        issueId: issue.id,
        insurerSupplierId: supplier?.id ?? null,
        insurerName,
        contractId,
        policyNumber,
        reference,
        status: 'open',
        openedAt: new Date(),
        openedByKind: input.actor.kind,
        openedByUserId:
          input.actor.kind === 'person' ? (input.actor.userId ?? null) : null,
        contactName: clean(input.contactName),
        contactPhone: clean(input.contactPhone),
      },
    });
    await this.events.record(db, {
      issueId: issue.id,
      kind: 'claim_opened',
      actorKind: input.actor.kind,
      authorUserId: input.actor.userId,
      text: `Siniestro abierto con ${insurerName}${reference ? ` (${reference})` : ''}.`,
      refType: CLAIM_WAIT_REF_TYPE,
      refId: claim.id,
      meta: {
        claimId: claim.id,
        insurerSupplierId: claim.insurerSupplierId,
        contractId,
        reference,
        policyNumber,
      },
    });
    // El trabajo humano «abrir el siniestro» / «pedir al propietario que lo tramite» ya está hecho.
    await this.settleRouteTasks(db, issue.id, input.actor);
    return { claim };
  }

  async update(
    db: Db,
    input: UpdateClaimInput,
  ): Promise<{ claim: InsuranceClaim; changed: boolean; tasks: OpenedTask[] }> {
    const provided = [
      input.reference,
      input.status,
      input.contactName,
      input.contactPhone,
      input.policyNumber,
    ].some((v) => v !== undefined);
    if (!provided)
      throw new BadRequestException('Indica qué cambia del siniestro.');
    if (input.status !== undefined && !isClaimStatus(input.status))
      throw new BadRequestException('Estado de siniestro no válido.');
    await this.workflow.lockIssue(db, input.issueId);
    const issue = await this.workflow.scope(db, input.issueId);
    // Un siniestro terminal ya no cambia, pero se puede localizar por su id para decirlo con claridad.
    const claim = (await this.resolveClaim(db, issue.id, input.claimId, {
      allowTerminal: true,
    })) as InsuranceClaim;

    const data: Prisma.InsuranceClaimUpdateInput = {};
    const changed: string[] = [];
    const reference =
      input.reference === undefined ? undefined : clean(input.reference);
    if (input.reference !== undefined && !reference)
      throw new BadRequestException('La referencia no puede quedar vacía.');
    if (reference && reference !== claim.reference) {
      await this.assertReferenceFree(
        db,
        issue.id,
        { ...claim, reference },
        claim.id,
      );
      data.reference = reference;
      changed.push('reference');
    }
    for (const [key, value] of [
      ['contactName', input.contactName],
      ['contactPhone', input.contactPhone],
      ['policyNumber', input.policyNumber],
    ] as const) {
      if (value === undefined) continue;
      const next = clean(value);
      if (next !== claim[key]) {
        data[key] = next;
        changed.push(key);
      }
    }
    const from = claim.status;
    const to = input.status;
    const statusChanged = to !== undefined && to !== from;
    if (statusChanged) {
      if (!canChangeClaimStatus(from, to))
        throw new ConflictException(
          'El siniestro está cerrado o desistido: ya no cambia de estado.',
        );
      // Sobre una incidencia cerrada solo se puede terminar el siniestro, nunca devolverlo a un estado vivo.
      if (!isTerminalClaimStatus(to))
        this.assertIssueNotClosed(issue.status, 'reactivate');
      data.status = to;
      if (isTerminalClaimStatus(to)) data.closedAt = new Date();
      changed.push('status');
    }
    if (isTerminalClaimStatus(from) && changed.length > 0)
      throw new ConflictException(
        'El siniestro está cerrado o desistido: ya no admite cambios.',
      );
    if (changed.length === 0) return { claim, changed: false, tasks: [] };

    const updated = await db.insuranceClaim.update({
      where: { id: claim.id },
      data,
    });
    const label = `${updated.insurerName}${updated.reference ? ` (${updated.reference})` : ''}`;
    const parts: string[] = [];
    if (changed.includes('reference'))
      parts.push(
        claim.reference
          ? `La referencia del siniestro con ${updated.insurerName} pasa a ser ${updated.reference}.`
          : `${updated.insurerName} asigna la referencia ${updated.reference} al siniestro.`,
      );
    if (statusChanged && to)
      parts.push(
        `Siniestro con ${label}: ${CLAIM_STATUS_LABELS[to].toLowerCase()}.`,
      );
    if (parts.length === 0)
      parts.push(`Datos del siniestro con ${label} actualizados.`);
    await this.events.record(db, {
      issueId: issue.id,
      kind: 'claim_updated',
      actorKind: input.actor.kind,
      authorUserId: input.actor.userId,
      text: parts.join(' '),
      refType: CLAIM_WAIT_REF_TYPE,
      refId: claim.id,
      meta: {
        claimId: claim.id,
        changed,
        ...(statusChanged ? { from, to } : {}),
        ...(changed.includes('reference')
          ? { reference: updated.reference }
          : {}),
      },
    });

    const tasks: OpenedTask[] = [];
    if (statusChanged && to) {
      const rejectionTask = `claim_rejected:${claim.id}`;
      if (to === 'rejected') {
        // La aseguradora ya contestó: la espera se da por cumplida y alguien tiene que decidir cómo seguir.
        await this.workflow.endWaits(
          db,
          { issueId: issue.id, kind: 'insurer_reply', refId: claim.id },
          'fulfilled',
          input.actor,
        );
        await this.workflow.supersedeChaseTasks(db, issue.id, {
          claimId: claim.id,
        });
        const task = await this.workflow.openTask(db, {
          issueId: issue.id,
          kind: 'review_issue',
          payload: {
            reason: 'claim_rejected',
            note: `${label}: cobertura rechazada.`,
          },
          discriminator: rejectionTask,
          createdBy: 'system',
        });
        if (task.created) tasks.push(task);
      } else {
        // Se reconsidera (o se termina): la decisión que pedía el rechazo ya no hace falta.
        await this.workflow.supersedeTasks(db, issue.id, {
          kinds: ['review_issue'],
          discriminator: rejectionTask,
        });
        if (isTerminalClaimStatus(to)) {
          await this.workflow.endWaits(
            db,
            { issueId: issue.id, kind: 'insurer_reply', refId: claim.id },
            'cancelled',
            input.actor,
          );
          await this.workflow.supersedeChaseTasks(db, issue.id, {
            claimId: claim.id,
          });
        }
      }
    }
    return { claim: updated, changed: true, tasks };
  }

  /** El siniestro de una espera a la aseguradora: el único vivo (o el indicado); ninguno si aún no hay siniestros. */
  claimForInsurerWait(
    db: Db,
    issueId: string,
    claimId: string | undefined,
  ): Promise<InsuranceClaim | null> {
    return this.resolveClaim(db, issueId, claimId, { optional: true });
  }

  /** Siniestros de la incidencia con su etapa derivada, el profesional enviado y lo que se espera de la aseguradora. */
  async list(issueId: string): Promise<ClaimView[]> {
    const claims = await this.prisma.insuranceClaim.findMany({
      where: { issueId },
      orderBy: { openedAt: 'asc' },
    });
    if (claims.length === 0) return [];
    const ids = claims.map((c) => c.id);
    const [assignments, waits] = await Promise.all([
      this.prisma.issueProviderAssignment.findMany({
        where: { issueId, unassignedAt: null, claimId: { in: ids } },
      }),
      this.prisma.issueWait.findMany({
        where: {
          issueId,
          endedAt: null,
          refType: CLAIM_WAIT_REF_TYPE,
          refId: { in: ids },
        },
        select: { refId: true, startedAt: true, dueAt: true },
      }),
    ]);
    return claims.map((c) => {
      const assignment = assignments.find((a) => a.claimId === c.id);
      const wait = waits.find((w) => w.refId === c.id);
      return {
        id: c.id,
        insurerName: c.insurerName,
        insurerSupplierId: c.insurerSupplierId,
        contractId: c.contractId,
        policyNumber: c.policyNumber,
        reference: c.reference,
        status: c.status,
        stage: claimStage({
          status: c.status,
          professionalAssigned: !!assignment,
        }),
        openedAt: c.openedAt,
        closedAt: c.closedAt,
        contactName: c.contactName,
        contactPhone: c.contactPhone,
        professional: assignment
          ? {
              assignmentId: assignment.id,
              supplierId: assignment.supplierId,
              name: assignment.providerNameSnapshot,
              phone: assignment.phoneSnapshot,
            }
          : null,
        waiting: wait ? { since: wait.startedAt, dueAt: wait.dueAt } : null,
      };
    });
  }

  /**
   * Invariante «Cerrada ⇒ ningún siniestro no terminal»: sobre una incidencia cerrada no se abre un siniestro ni se
   * reactiva uno (los terminales ya no cambian; solo podría ser un rechazo de antes de esta regla). Resuelta no lo impide.
   */
  private assertIssueNotClosed(
    issueStatus: string,
    action: 'open' | 'reactivate',
  ): void {
    if (issueStatus !== 'Cerrada' && issueStatus !== 'Retirada') return;
    throw new ConflictException({
      code: ISSUE_CLOSED_INSURANCE_CLAIM_NOT_ALLOWED,
      message:
        action === 'open'
          ? 'La incidencia está cerrada: no admite abrir un siniestro nuevo.'
          : 'La incidencia está cerrada: el siniestro solo puede terminarse (desistido o cerrado), no reactivarse.',
    });
  }

  /** Un nº de siniestro no se repite para la misma aseguradora en la misma incidencia (dos aseguradoras sí pueden). */
  private async assertReferenceFree(
    db: Db,
    issueId: string,
    claim: {
      insurerSupplierId: string | null;
      insurerName: string;
      reference: string | null;
    },
    exceptId?: string,
  ): Promise<void> {
    if (!claim.reference) return;
    const key = insurerKey(claim.insurerSupplierId, claim.insurerName);
    const reference = normalizeClaimText(claim.reference);
    const others = await db.insuranceClaim.findMany({
      where: {
        issueId,
        reference: { not: null },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { reference: true, insurerSupplierId: true, insurerName: true },
    });
    if (
      others.some(
        (o) =>
          insurerKey(o.insurerSupplierId, o.insurerName) === key &&
          normalizeClaimText(o.reference as string) === reference,
      )
    )
      throw new ConflictException(
        'Ya hay un siniestro con esa referencia para esa aseguradora en esta incidencia.',
      );
  }

  /**
   * Abrir el siniestro resuelve la tarea que lo pedía (a la administración, si la vía es el seguro de la comunidad; al
   * propietario, si es el suyo). Si quien lo abre no es una persona, la tarea ya no hace falta y queda sustituida.
   */
  private async settleRouteTasks(
    db: Db,
    issueId: string,
    actor: WorkflowActor,
  ): Promise<void> {
    for (const discriminator of [
      'open_insurance_claim',
      'ask_owner_file_claim',
    ]) {
      if (actor.kind === 'person' && actor.userId)
        await this.workflow.resolveTasks(db, issueId, 'review_issue', {
          outcome: 'done',
          resultRef: { decision: 'done' },
          userId: actor.userId,
          discriminator,
        });
      else
        await this.workflow.supersedeTasks(db, issueId, {
          kinds: ['review_issue'],
          discriminator,
        });
    }
  }
}
