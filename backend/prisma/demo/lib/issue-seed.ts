import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '../../../src/prisma/client';
import { issueEventData } from '../../../src/issue-workflow/issue-events.service';
import type { StorageService } from '../../../src/files/storage.service';
import type { PortfolioIssue } from '../data/portfolio';
import { makeIssuePhoto } from './issue-photo';

/**
 * Alta de UNA incidencia demo con todo su detalle (historial, proveedor,
 * presupuesto, notificaciones y fotos). La comparten la fase F4 del seed demo y
 * el script que rellena una BD local ya existente (`scripts/seed-local-issues.ts`).
 * Todo RAW: los servicios de incidencias arrastran la IA y fechan con `new Date()`.
 */

const OPEN_PATH = ['Abierta', 'EnReparacion', 'PendienteProveedor'] as const;

export interface SeededIssueInput {
  ref: string;
  /** La comunidad: una incidencia es siempre de la finca, no de una vivienda. */
  estateId: string;
  spec: PortfolioIssue;
  gestoraId: string;
  /** Vecino de la comunidad que abre la incidencia cuando `spec.source` es «Propietario». */
  owner?: { id: string; fullName: string };
  /** Proveedor asignado: con `id` si existe en `suppliers`; sin él, solo la copia congelada. */
  supplier?: { id?: string; name: string; category: string; phone: string | null };
  /** Propietarios a los que se notificó cada envío. */
  recipients: number;
  /** Etiqueta de la finca para el asunto de las notificaciones. */
  estateName: string;
  /** Fecha a `offset` días de «hoy» del seed (negativo = pasado). */
  day: (offset: number) => Date;
  /** Semilla de las fotos: distintas incidencias, distintas imágenes. */
  photoSeed: number;
  /** Cuántas fotos; por defecto, según tipo y prioridad. */
  photoCount?: number;
}

type Db = Pick<PrismaClient, 'issue' | 'issueProviderAssignment' | 'issueNotification' | 'issuePhoto'>;

export async function createSeededIssue(db: Db, storage: StorageService, input: SeededIssueInput): Promise<string> {
  const { spec, gestoraId, owner, supplier, day } = input;
  const byOwner = spec.source === 'Propietario' && owner !== undefined;
  const created = day(-spec.createdAgoDays);
  const resolved = spec.resolvedAgoDays !== undefined ? day(-spec.resolvedAgoDays) : null;
  const text = spec.description ?? `${spec.title}. Registrada por la administración.`;
  // Transiciones: Abierta -> (EnReparacion) -> estado final, repartidas entre alta y resolución.
  const finalReached = spec.status === 'Resuelta' || spec.status === 'Cerrada';
  const path: string[] = ['Abierta'];
  if (spec.status !== 'Abierta') path.push('EnReparacion');
  if (spec.status === 'PendienteProveedor' || finalReached) {
    if (spec.status === 'PendienteProveedor') path.push('PendienteProveedor');
    if (finalReached) path.push('Resuelta');
    if (spec.status === 'Cerrada') path.push('Cerrada');
  }
  const end = resolved ?? day(-Math.max(0, spec.createdAgoDays - 4));
  const span = end.getTime() - created.getTime();
  const at = (fraction: number) => new Date(created.getTime() + span * fraction);

  const reportId = randomUUID();
  const row = await db.issue.create({
    data: {
      ref: input.ref,
      estateId: input.estateId,
      type: spec.type,
      title: spec.title,
      description: text,
      status: spec.status,
      priority: spec.priority,
      source: byOwner ? 'Propietario' : 'Comunidad',
      date: created,
      ownerName: owner?.fullName ?? null,
      budgetAmount: spec.budget?.amount ?? null,
      budgetDescription: spec.budget?.description ?? null,
      budgetApproved: spec.budget?.approved ?? null,
      resolvedAt: finalReached ? end : null,
      closedAt: spec.status === 'Cerrada' ? end : null,
      // El aviso original: canal, contenido tal como llegó y quién avisó.
      reports: {
        create: {
          id: reportId,
          channel: 'form',
          content: text,
          reporterUserId: byOwner ? owner.id : null,
          reporterName: owner?.fullName ?? null,
          receivedAt: created,
          createdByKind: 'person',
          createdByUserId: byOwner ? owner.id : gestoraId,
        },
      },
      timeline: {
        create: [
          byOwner
            ? issueEventData({ kind: 'report_received', actorKind: 'person', authorUserId: owner.id, role: 'Propietario', date: created, text, refType: 'issue_report', refId: reportId })
            : issueEventData({ kind: 'report_received', actorKind: 'person', authorUserId: gestoraId, date: created, text, refType: 'issue_report', refId: reportId }),
          ...(byOwner
            ? [issueEventData({ kind: 'note', actorKind: 'person', authorUserId: gestoraId, date: new Date(created.getTime() + 3_600_000), text: 'Incidencia recibida; la administración la revisa.' })]
            : []),
          ...path.slice(1).map((to, k) =>
            issueEventData({
              kind: 'status_changed',
              actorKind: 'person',
              authorUserId: gestoraId,
              date: new Date(created.getTime() + (span * (k + 1)) / path.length),
              text: `Estado actualizado a ${to}.`,
              fromStatus: path[k] as (typeof OPEN_PATH)[number],
              toStatus: to as (typeof OPEN_PATH)[number],
            }),
          ),
          ...(supplier
            ? [issueEventData({ kind: 'provider_assigned', actorKind: 'person', authorUserId: gestoraId, date: at(0.2), text: `Proveedor asignado: ${supplier.name}.` })]
            : []),
          ...(spec.budget
            ? [
                issueEventData({
                  kind: 'budget_updated',
                  actorKind: 'person',
                  authorUserId: gestoraId,
                  date: at(0.4),
                  text: `Presupuesto de ${spec.budget.amount} € (${spec.budget.description}) ${spec.budget.approved ? 'aprobado' : 'pendiente de aprobación'}.`,
                }),
              ]
            : []),
          ...(spec.note ? [issueEventData({ kind: 'note', actorKind: 'person', authorUserId: gestoraId, date: at(0.6), text: spec.note })] : []),
        ],
      },
    },
  });

  if (supplier) {
    await db.issueProviderAssignment.create({
      data: {
        issueId: row.id,
        supplierId: supplier.id ?? null,
        providerNameSnapshot: supplier.name,
        categorySnapshot: supplier.category,
        phoneSnapshot: supplier.phone,
        estimatedResolutionDate: spec.etaInDays !== undefined ? day(spec.etaInDays) : null,
        assignedAt: at(0.2),
        assignedByUserId: gestoraId,
      },
    });
  }

  // Fotos del aviso: salvo el ruido (no se fotografía), una; dos si es urgente; y una más cada tercera.
  const photoCount = input.photoCount ?? (spec.type === 'Ruido' ? 0 : 1 + (spec.priority === 'Urgente' ? 1 : 0) + (input.photoSeed % 3 === 0 ? 1 : 0));
  for (let p = 0; p < photoCount; p++) {
    const key = await storage.put(`issues/${row.id}`, `foto-${p + 1}.png`, makeIssuePhoto(spec.type, input.photoSeed * 7 + p));
    await db.issuePhoto.create({ data: { issueId: row.id, s3Key: key, url: null, uploadedAt: new Date(created.getTime() + (p + 1) * 600_000) } });
  }

  for (const agoDays of spec.notifiedAgoDays ?? []) {
    await db.issueNotification.create({
      data: {
        issueId: row.id,
        // Nunca antes del alta de la incidencia.
        sentAt: day(-Math.min(agoDays, spec.createdAgoDays)),
        recipientsCount: input.recipients,
        channel: 'email',
        sentByUserId: gestoraId,
        subject: `Incidencia en ${input.estateName}: ${spec.title}`,
        body: `${text} Le mantendremos informado de su evolución.`,
      },
    });
  }
  return row.id;
}
