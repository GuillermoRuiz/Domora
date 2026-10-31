import { BadRequestException, Injectable } from '@nestjs/common';
import type { AgendaLinkType } from '../prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { LINK_TAB } from './agenda-task.constants';
import type { LinkedEntityView } from './agenda-task.types';

export interface LinkRef {
  type: AgendaLinkType;
  id: string;
}

/** Un vínculo ya guardado: lo vinculado y el título con el que se guardó. */
export interface StoredLinkRef extends LinkRef {
  label?: string | null;
}

/** Texto de un vínculo cuya entidad ya no existe y del que no se guardó el título. */
export const DELETED_ENTITY_LABEL = 'Entidad eliminada';

/**
 * Resuelve las entidades de Domora a las que se vincula una tarea. La
 * relación es polimórfica (sin FK), así que aquí es donde se garantiza que
 * la entidad existe Y que pertenece a una finca a la que el usuario tiene
 * acceso: una tarea nunca debe servir para llegar a una entidad ajena.
 */
@Injectable()
export class AgendaTaskLinksService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Valida y describe los vínculos pedidos. Lanza 400 si alguno no existe o
   * no es accesible (mismo mensaje en ambos casos para no revelar cuál).
   */
  async resolveForUser(
    user: AuthenticatedUser,
    links: LinkRef[],
  ): Promise<LinkedEntityView[]> {
    const unique = this.dedupe(links);
    const described = await this.describe(unique);
    const accessible = new Set(user.estateIds);
    const result: LinkedEntityView[] = [];
    for (const ref of unique) {
      const entity = described.get(this.key(ref));
      if (!entity || !accessible.has(entity.estateId)) {
        throw new BadRequestException(
          'Una de las entidades vinculadas no existe o no es accesible.',
        );
      }
      result.push(entity);
    }
    return result;
  }

  /**
   * Describe vínculos ya guardados (lectura). Los que ya no existen se
   * omiten en silencio: la entidad pudo borrarse después de crear la tarea.
   */
  async describeStored(
    user: AuthenticatedUser,
    links: LinkRef[],
  ): Promise<LinkedEntityView[]> {
    const described = await this.describe(this.dedupe(links));
    const accessible = new Set(user.estateIds);
    return links
      .map((ref) => described.get(this.key(ref)))
      .filter((e): e is LinkedEntityView => !!e && accessible.has(e.estateId));
  }

  /**
   * Describe los vínculos de una tarea PARA MOSTRARLOS: ninguno se omite en silencio. Los que existen y son accesibles salen con
   * su título actual; los que ya no existen (borrados, en la papelera) salen marcados `deleted` con el título guardado al
   * vincular (o «Entidad eliminada»). Solo se omite lo que existe pero cae fuera de las fincas del usuario: no se revela.
   */
  async describeForDisplay(
    user: AuthenticatedUser,
    links: StoredLinkRef[],
    fallbackEstateId: string | null,
  ): Promise<LinkedEntityView[]> {
    const described = await this.describe(this.dedupe(links));
    const accessible = new Set(user.estateIds);
    const gone = links.filter((l) => !described.has(this.key(l)));
    // Una incidencia o un documento en la papelera siguen existiendo: de ellos se recupera el título y la finca.
    const trashedIssues = new Map(
      (gone.some((l) => l.type === 'issue')
        ? await this.prisma.issue.findMany({
            where: { id: { in: this.idsOf(gone, 'issue') } },
            select: { id: true, ref: true, title: true, estateId: true },
          })
        : []
      ).map((i) => [i.id, i]),
    );
    const out: LinkedEntityView[] = [];
    for (const ref of links) {
      const live = described.get(this.key(ref));
      if (live) {
        if (accessible.has(live.estateId)) out.push(live);
        continue;
      }
      const trashed =
        ref.type === 'issue' ? trashedIssues.get(ref.id) : undefined;
      if (trashed && !accessible.has(trashed.estateId)) continue;
      out.push({
        type: ref.type,
        id: ref.id,
        label: trashed
          ? `${trashed.ref} · ${trashed.title}`
          : (ref.label ?? DELETED_ENTITY_LABEL),
        estateId: trashed?.estateId ?? fallbackEstateId ?? '',
        route: '',
        deleted: true,
      });
    }
    return out;
  }

  private key(ref: LinkRef): string {
    return `${ref.type}:${ref.id}`;
  }

  private dedupe(links: LinkRef[]): LinkRef[] {
    return [...new Map(links.map((l) => [this.key(l), l])).values()];
  }

  private idsOf(links: LinkRef[], type: AgendaLinkType): string[] {
    return links.filter((l) => l.type === type).map((l) => l.id);
  }

  private async describe(
    links: LinkRef[],
  ): Promise<Map<string, LinkedEntityView>> {
    const out = new Map<string, LinkedEntityView>();
    const put = (
      type: AgendaLinkType,
      id: string,
      label: string,
      estateId: string | null,
    ) => {
      if (!estateId) return;
      out.set(`${type}:${id}`, {
        type,
        id,
        label,
        estateId,
        // Las incidencias ya no son una pestaña de la finca: su vínculo abre la propia incidencia.
        route:
          type === 'issue'
            ? `/b/incidencias/${id}`
            : `/b/estates/${estateId}?tab=${LINK_TAB[type]}&entity=${id}`,
        deleted: false,
      });
    };

    const issueIds = this.idsOf(links, 'issue');
    const meetingIds = this.idsOf(links, 'meeting');
    const supplierIds = this.idsOf(links, 'supplier');
    const documentIds = this.idsOf(links, 'document');

    const [issues, meetings, suppliers, documents] = await Promise.all([
      issueIds.length
        ? this.prisma.issue.findMany({
            where: { id: { in: issueIds }, deletedAt: null },
            select: {
              id: true,
              ref: true,
              title: true,
              estateId: true,
            },
          })
        : [],
      meetingIds.length
        ? this.prisma.meeting.findMany({
            where: { id: { in: meetingIds } },
            select: { id: true, title: true, estateId: true },
          })
        : [],
      supplierIds.length
        ? this.prisma.supplier.findMany({
            where: { id: { in: supplierIds } },
            select: { id: true, name: true, estateId: true },
          })
        : [],
      documentIds.length
        ? this.prisma.document.findMany({
            // Staff-only links: deleted (trashed) documents are no longer linkable.
            where: { id: { in: documentIds }, deletedAt: null },
            select: { id: true, title: true, estateId: true },
          })
        : [],
    ]);

    for (const i of issues)
      put('issue', i.id, `${i.ref} · ${i.title}`, i.estateId);
    for (const m of meetings) put('meeting', m.id, m.title, m.estateId);
    for (const s of suppliers) put('supplier', s.id, s.name, s.estateId);
    for (const d of documents) put('document', d.id, d.title, d.estateId);
    return out;
  }
}
