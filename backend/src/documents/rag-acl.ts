import type { DocumentVisibility } from '../prisma/client';

/**
 * Assistant (RAG) access list of an indexed document, from its library visibility.
 * Retrieval in the RAG service filters by this ACL, so it must never be wider than the library:
 * only «Todos los propietarios» is community-wide; «Junta» and «Solo gestora» stay staff-only.
 */
export function ragAclFor(doc: {
  effectiveVisibility: DocumentVisibility;
  targetPropertyId: string | null;
}) {
  const forOwners = doc.effectiveVisibility === 'OWNERS';
  const forProperty =
    doc.effectiveVisibility === 'PROPERTY' && !!doc.targetPropertyId;
  return {
    classification: forOwners ? 'community' : 'restricted',
    acl: {
      community: forOwners,
      roles: ['A', 'B'],
      users: [] as string[],
      properties: forProperty ? [doc.targetPropertyId as string] : [],
    },
  };
}
