import {
  InteractionForm,
  MAX_INTERACTION_EFFECTS,
  buildInteraction,
  buildRequesterNotice,
  emptyInteractionForm,
} from './issue-interaction.builder';

const NOW = new Date('2026-10-23T10:00:00.000Z');
const form = (over: Partial<InteractionForm>): InteractionForm => ({ ...emptyInteractionForm(), ...over });
const tomorrow = '2026-10-24T10:00';

describe('buildInteraction: lo que cuenta la persona se traduce a los DTO del backend', () => {
  it('«He llamado a Mapfre. Nos darán número de siniestro.» → llamada al seguro y esperamos su respuesta', () => {
    const built = buildInteraction(
      form({
        medium: 'phone',
        party: 'insurer',
        partyLabel: 'Mapfre',
        summary: 'He llamado a Mapfre. Nos darán número de siniestro.',
        claimRef: 'SIN-2026-123',
        waitForReply: true,
        waitDays: 3,
      }),
      NOW,
    );
    expect(built.ok).toBe(true);
    expect(built.body).toEqual({
      channel: 'phone',
      direction: 'outbound',
      party: 'insurer',
      partyLabel: 'Mapfre',
      summary: 'He llamado a Mapfre. Nos darán número de siniestro.',
      claimRef: 'SIN-2026-123',
      effects: [{ type: 'start_wait', kind: 'insurer_reply', partyLabel: 'Mapfre', dueInHours: 72 }],
    });
  });

  it('«El proveedor confirma por WhatsApp que viene el viernes.» → cierra la espera, programa la visita y avisa al solicitante', () => {
    const built = buildInteraction(
      form({
        medium: 'whatsapp',
        direction: 'inbound',
        party: 'provider',
        supplierId: 'sup-1',
        supplierName: 'Ascensores Levante',
        summary: 'El proveedor confirma por WhatsApp que viene el viernes.',
        closeWaitId: 'wait-1',
        visitAt: '2026-10-30T09:00',
        informTemplate: 'visit_scheduled',
      }),
      NOW,
    );
    expect(built.ok).toBe(true);
    expect(built.body).toMatchObject({ channel: 'whatsapp', direction: 'inbound', party: 'provider', supplierId: 'sup-1' });
    expect(built.body?.partyLabel).toBeUndefined();
    const scheduledAt = new Date('2026-10-30T09:00').toISOString();
    expect(built.body?.effects).toEqual([
      { type: 'end_wait', waitId: 'wait-1', reason: 'fulfilled' },
      { type: 'schedule_visit', supplierId: 'sup-1', scheduledAt },
      { type: 'inform_requester', template: 'visit_scheduled', when: scheduledAt },
    ]);
  });

  it('«El propietario confirma que sigue la fuga.» → conversación con el propietario, sin consecuencias', () => {
    const built = buildInteraction(
      form({ medium: 'in_person', direction: 'inbound', party: 'owner', partyLabel: 'La propietaria del 3ºB', summary: 'El propietario confirma que sigue la fuga.' }),
      NOW,
    );
    expect(built.body).toEqual({
      channel: 'in_person',
      direction: 'inbound',
      party: 'owner',
      partyLabel: 'La propietaria del 3ºB',
      summary: 'El propietario confirma que sigue la fuga.',
    });
  });

  it('crear un seguimiento lleva la fecha y hora del recordatorio (la de la tarea)', () => {
    const built = buildInteraction(
      form({ party: 'other', partyLabel: 'Administrador de fincas', summary: 'Zanjado.', followUpNote: 'Comprobar en una semana', followUpMilestone: 'created', followUpAt: '2026-10-30T09:30' }),
      NOW,
    );
    expect(built.body?.effects).toEqual([
      { type: 'open_follow_up', note: 'Comprobar en una semana', milestone: 'created', dueAt: new Date('2026-10-30T09:30').toISOString() },
    ]);
  });

  it('una tarea sin hito del recorrido no se puede crear', () => {
    const built = buildInteraction(
      form({ party: 'other', partyLabel: 'x', summary: 'x', followUpNote: 'Llamar', followUpAt: '2026-10-30T09:30' }),
      NOW,
    );
    expect(built.ok).toBe(false);
    expect(built.errors).toContain('Elige a qué hito del recorrido pertenece la tarea.');
  });

  it('el seguimiento exige fecha y hora, y que sean futuras', () => {
    const base = { party: 'other' as const, partyLabel: 'x', summary: 'x', followUpNote: 'Llamar' };
    expect(buildInteraction(form(base), NOW).errors).toContain('Indica cuándo quieres que te lo recordemos.');
    expect(buildInteraction(form({ ...base, followUpAt: '2026-10-01T10:00' }), NOW).errors).toContain('El recordatorio tiene que ser en una fecha futura.');
    expect(buildInteraction(form({ ...base, followUpNote: '  ', followUpAt: '2026-10-01T10:00' }), NOW).ok).toBe(true);
  });

  it('el aviso con texto libre lleva el texto escrito y lo exige', () => {
    const base = { party: 'other' as const, partyLabel: 'x', summary: 'x', informTemplate: 'custom' as const };
    expect(buildInteraction(form({ ...base, informText: '   ' }), NOW).errors).toContain('Escribe el mensaje para quien reportó la incidencia.');
    const ok = buildInteraction(form({ ...base, informText: '  Pasamos mañana a verlo.  ' }), NOW);
    expect(ok.body?.effects).toEqual([{ type: 'inform_requester', template: 'custom', text: 'Pasamos mañana a verlo.' }]);
  });

  it('avisar al solicitante de un tercero lleva su nombre; sin nombre, uno genérico', () => {
    const named = buildInteraction(form({ party: 'insurer', partyLabel: 'Mapfre', summary: 'x', informTemplate: 'third_party_contacted' }), NOW);
    expect(named.body?.effects).toEqual([{ type: 'inform_requester', template: 'third_party_contacted', label: 'Mapfre' }]);
    const generic = buildInteraction(form({ party: 'provider', supplierId: 's', summary: 'x', informTemplate: 'waiting_third_party' }), NOW);
    expect(generic.body?.effects).toEqual([{ type: 'inform_requester', template: 'waiting_third_party', label: 'el proveedor' }]);
  });

  it('un proveedor del directorio se manda por su identificador, no por nombre; el nombre libre solo si no hay directorio', () => {
    const dir = buildInteraction(form({ party: 'provider', supplierId: 's1', partyLabel: 'ignorado?', summary: 'x', waitForReply: true }), NOW);
    expect(dir.body?.supplierId).toBe('s1');
    expect(dir.body?.effects).toEqual([{ type: 'start_wait', kind: 'provider_reply', supplierId: 's1' }]);
    const owner = buildInteraction(form({ party: 'owner', supplierId: 's1', partyLabel: 'Ana', summary: 'x' }), NOW);
    expect(owner.body?.supplierId).toBeUndefined(); // el propietario nunca se vincula al directorio
  });

  it('sin resumen o sin contraparte no se envía nada', () => {
    expect(buildInteraction(form({ party: 'provider', summary: '   ' }), NOW)).toMatchObject({ ok: false, body: null });
    const noParty = buildInteraction(form({ party: 'provider', summary: 'x', partyLabel: '  ' }), NOW);
    expect(noParty.ok).toBe(false);
    expect(noParty.errors).toContain('Indica con quién has hablado.');
  });

  it('la visita se puede programar con cualquier contraparte: sin proveedor del directorio ni profesional asignado es de quien se nombra', () => {
    const scheduledAt = new Date(tomorrow).toISOString();
    const owner = buildInteraction(form({ party: 'owner', partyLabel: 'La propietaria del 3ºB', summary: 'x', visitAt: tomorrow }), NOW);
    expect(owner.body?.effects).toEqual([{ type: 'schedule_visit', visitorLabel: 'La propietaria del 3ºB', scheduledAt }]);
    const typed = buildInteraction(form({ party: 'provider', partyLabel: 'Fontanería Pérez', summary: 'x', visitAt: tomorrow }), NOW);
    expect(typed.body?.effects).toEqual([{ type: 'schedule_visit', visitorLabel: 'Fontanería Pérez', scheduledAt }]);
    // Con un profesional ya asignado, la visita es suya: no se nombra a nadie más.
    const assigned = buildInteraction(form({ party: 'owner', partyLabel: 'x', summary: 'x', visitAt: tomorrow }), NOW, { liveClaims: 0, hasAssignedProfessional: true });
    expect(assigned.body?.effects).toEqual([{ type: 'schedule_visit', scheduledAt }]);
  });

  it('la visita exige fecha futura; el aviso de visita exige visita', () => {
    expect(buildInteraction(form({ party: 'provider', supplierId: 's', summary: 'x', visitAt: '2026-10-01T10:00' }), NOW).errors).toContain(
      'La visita tiene que ser en una fecha futura.',
    );
    expect(buildInteraction(form({ party: 'provider', supplierId: 's', summary: 'x', informTemplate: 'visit_scheduled' }), NOW).errors).toContain(
      'Para avisar de la visita, programa antes la visita.',
    );
  });

  it('«Seguro» con un proveedor del directorio NO programa la visita con la aseguradora: la visita es del profesional asignado', () => {
    const built = buildInteraction(
      form({ party: 'insurer', supplierId: 'mapfre', summary: 'x', visitAt: tomorrow }),
      NOW,
      { liveClaims: 1, hasAssignedProfessional: true },
    );
    expect(built.ok).toBe(true);
    expect(built.body?.effects).toEqual([{ type: 'schedule_visit', scheduledAt: new Date(tomorrow).toISOString() }]);
    // Sin profesional asignado, la visita es de la aseguradora con la que se habla.
    expect(buildInteraction(form({ party: 'insurer', supplierId: 'mapfre', supplierName: 'Mapfre', summary: 'x', visitAt: tomorrow }), NOW).body?.effects).toEqual([
      { type: 'schedule_visit', visitorLabel: 'Mapfre', scheduledAt: new Date(tomorrow).toISOString() },
    ]);
  });

  it(`no se envían más de ${MAX_INTERACTION_EFFECTS} consecuencias a la vez (el servidor tampoco las admite)`, () => {
    const built = buildInteraction(
      form({
        party: 'insurer', partyLabel: 'Mapfre', summary: 'x', closeWaitId: 'w', openClaim: true, waitForReply: true,
        assignPro: true, assignProName: 'Pérez', visitAt: tomorrow, followUpNote: 'n', followUpAt: '2026-10-25T10:00',
        informTemplate: 'visit_scheduled',
      }),
      NOW,
    );
    expect(built.ok).toBe(false);
    expect(built.errors.join(' ')).toContain('demasiadas cosas a la vez');
  });

  it('la espera usa el tipo que corresponde a la contraparte', () => {
    const kind = (party: 'provider' | 'insurer' | 'owner' | 'other') =>
      (buildInteraction(form({ party, partyLabel: 'x', supplierId: null, summary: 'x', waitForReply: true }), NOW).body?.effects?.[0] as { kind: string }).kind;
    expect([kind('provider'), kind('insurer'), kind('owner'), kind('other')]).toEqual(['provider_reply', 'insurer_reply', 'owner_reply', 'other_reply']);
  });
});

describe('buildRequesterNotice: aviso suelto al solicitante', () => {
  it('es una gestión sin contraparte externa con el efecto de informar', () => {
    const built = buildRequesterNotice('issue_resolved', {}, NOW);
    expect(built.body).toMatchObject({ channel: 'other', direction: 'outbound', party: 'requester', effects: [{ type: 'inform_requester', template: 'issue_resolved' }] });
  });
  it('la visita necesita una fecha futura y los avisos de un tercero necesitan su nombre', () => {
    expect(buildRequesterNotice('visit_scheduled', { when: null }, NOW).ok).toBe(false);
    expect(buildRequesterNotice('visit_scheduled', { when: '2026-10-01T10:00:00Z' }, NOW).ok).toBe(false);
    const visit = buildRequesterNotice('visit_scheduled', { when: '2026-10-30T08:00:00.000Z' }, NOW);
    expect(visit.body?.effects).toEqual([{ type: 'inform_requester', template: 'visit_scheduled', when: '2026-10-30T08:00:00.000Z' }]);
    expect(buildRequesterNotice('third_party_contacted', { label: ' ' }, NOW).ok).toBe(false);
    expect(buildRequesterNotice('waiting_third_party', { label: 'Mapfre' }, NOW).body?.effects).toEqual([
      { type: 'inform_requester', template: 'waiting_third_party', label: 'Mapfre' },
    ]);
  });
});

describe('buildRequesterNotice: mensaje escrito', () => {
  it('lleva el texto recortado y no hace falta fecha ni tercero', () => {
    const built = buildRequesterNotice('custom', { text: '  Mañana pasa el técnico.  ' }, NOW);
    expect(built.ok).toBe(true);
    expect(built.body?.effects).toEqual([{ type: 'inform_requester', template: 'custom', text: 'Mañana pasa el técnico.' }]);
    expect(built.body?.summary).toBe('Aviso al solicitante: mensaje escrito.');
  });
  it('sin texto, o pasado de largo, no se envía', () => {
    expect(buildRequesterNotice('custom', { text: '   ' }, NOW).errors).toEqual(['Escribe el mensaje que se enviará.']);
    expect(buildRequesterNotice('custom', { text: 'x'.repeat(501) }, NOW).ok).toBe(false);
  });
});

describe('buildInteraction: siniestro de seguro, sin enseñar conceptos técnicos', () => {
  const ctx = (liveClaims: number, hasAssignedProfessional = false) => ({ liveClaims, hasAssignedProfessional });

  it('«He llamado a Mapfre y he abierto el siniestro; esperamos su respuesta» → abre el siniestro y la espera, en ese orden', () => {
    const built = buildInteraction(
      form({
        party: 'insurer',
        supplierId: 'mapfre',
        summary: 'He llamado a Mapfre y he abierto el siniestro',
        openClaim: true,
        claimPolicy: ' POL-1 ',
        waitForReply: true,
        waitDays: 2,
      }),
      NOW,
      ctx(0),
    );
    expect(built.ok).toBe(true);
    expect(built.body?.effects).toEqual([
      { type: 'open_claim', policyNumber: 'POL-1' },
      { type: 'start_wait', kind: 'insurer_reply', supplierId: 'mapfre', dueInHours: 48 },
    ]);
  });

  it('el siniestro del seguro del propietario pide su aseguradora (no está en el directorio)', () => {
    const base = { party: 'owner' as const, partyLabel: 'La propietaria', summary: 'Ya lo abrió ella', openClaim: true, claimRef: 'A-1' };
    expect(buildInteraction(form(base), NOW, ctx(0)).errors).toContain('Indica la aseguradora del propietario.');
    const built = buildInteraction(form({ ...base, claimInsurerName: 'Seguros Pepe', claimPolicy: 'P-9' }), NOW, ctx(0));
    expect(built.body?.effects).toEqual([{ type: 'open_claim', insurerName: 'Seguros Pepe', policyNumber: 'P-9' }]);
    // El nº de siniestro viaja en la propia gestión: el servidor lo toma como referencia del siniestro nuevo.
    expect(built.body?.claimRef).toBe('A-1');
  });

  it('«Mapfre asigna referencia / rechaza cobertura» → actualiza el siniestro; con varios abiertos hay que indicar cuál', () => {
    const base = { party: 'insurer' as const, partyLabel: 'Mapfre', summary: 'Mapfre rechaza cobertura', claimStatus: 'rejected' as const, claimRef: 'SIN-7' };
    expect(buildInteraction(form(base), NOW, ctx(1)).body?.effects).toEqual([{ type: 'update_claim', status: 'rejected', reference: 'SIN-7' }]);
    const many = buildInteraction(form(base), NOW, ctx(2));
    expect(many.ok).toBe(false);
    expect(many.errors).toContain('Indica de qué siniestro hablas.');
    expect(buildInteraction(form({ ...base, claimId: 'c2' }), NOW, ctx(2)).body?.effects).toEqual([
      { type: 'update_claim', claimId: 'c2', status: 'rejected', reference: 'SIN-7' },
    ]);
    // Sin siniestro abierto no hay nada que actualizar: la referencia se queda en la comunicación.
    expect(buildInteraction(form(base), NOW, ctx(0)).body?.effects).toBeUndefined();
  });

  it('«Mapfre envía a un profesional» → queda atado al siniestro; la visita es de ese profesional, sin darlo de alta', () => {
    const built = buildInteraction(
      form({
        party: 'insurer',
        partyLabel: 'Mapfre',
        summary: 'Mapfre envía a Reparaciones Pérez',
        claimStatus: 'accepted',
        assignPro: true,
        assignProName: ' Reparaciones Pérez ',
        assignProPhone: '600',
        visitAt: tomorrow,
      }),
      NOW,
      ctx(1),
    );
    expect(built.ok).toBe(true);
    expect(built.body?.effects).toEqual([
      { type: 'update_claim', status: 'accepted' },
      { type: 'assign_provider', byInsurer: true, name: 'Reparaciones Pérez', phone: '600' },
      { type: 'schedule_visit', scheduledAt: new Date(tomorrow).toISOString() },
    ]);
  });

  it('el profesional del directorio se envía por su proveedor; sin siniestro o sin nombre no se construye', () => {
    const base = { party: 'insurer' as const, partyLabel: 'Mapfre', summary: 'x', assignPro: true };
    expect(buildInteraction(form({ ...base, assignProSupplierId: 'fontanero' }), NOW, ctx(1)).body?.effects).toEqual([
      { type: 'assign_provider', byInsurer: true, supplierId: 'fontanero' },
    ]);
    expect(buildInteraction(form({ ...base, assignProName: 'Pérez' }), NOW, ctx(0)).errors).toContain(
      'Para indicar el profesional que envía el seguro, abre antes el siniestro.',
    );
    expect(buildInteraction(form(base), NOW, ctx(1)).errors).toContain('Indica el profesional que envía el seguro.');
    expect(buildInteraction(form({ ...base, assignProName: 'Pérez' }), NOW, ctx(2)).errors).toContain('Indica de qué siniestro hablas.');
  });

  it('la espera a la aseguradora lleva el siniestro indicado; abrir y esperar en la misma gestión no lo necesita', () => {
    const wait = form({ party: 'insurer', partyLabel: 'Mapfre', summary: 'x', waitForReply: true, claimId: 'c2' });
    expect(buildInteraction(wait, NOW, ctx(2)).body?.effects).toEqual([
      { type: 'start_wait', kind: 'insurer_reply', partyLabel: 'Mapfre', claimId: 'c2' },
    ]);
    expect(buildInteraction({ ...wait, claimId: null }, NOW, ctx(2)).errors).toContain('Indica de qué siniestro hablas.');
  });

  it('un siniestro nuevo junto a otros abiertos no puede llevar espera ni profesional en la misma gestión (sería ambiguo)', () => {
    const base = { party: 'insurer' as const, partyLabel: 'Mapfre', summary: 'x', openClaim: true };
    const message = 'Ya hay un siniestro abierto: registra el nuevo en una gestión aparte para indicar su espera o su profesional.';
    expect(buildInteraction(form({ ...base, waitForReply: true }), NOW, ctx(1)).errors).toContain(message);
    expect(buildInteraction(form({ ...base, assignPro: true, assignProName: 'Pérez' }), NOW, ctx(1)).errors).toContain(message);
    // Sin otros siniestros abiertos no hay ambigüedad.
    expect(buildInteraction(form({ ...base, waitForReply: true }), NOW, ctx(0)).ok).toBe(true);
    // Abrir el nuevo solo (sin espera ni profesional) sí se puede.
    expect(buildInteraction(form(base), NOW, ctx(1)).ok).toBe(true);
  });

  it('con otras contrapartes no se construye ningún efecto de siniestro', () => {
    const built = buildInteraction(
      form({ party: 'provider', partyLabel: 'Fontanero', summary: 'x', openClaim: true, claimStatus: 'closed', assignPro: true, assignProName: 'x' }),
      NOW,
      ctx(1),
    );
    expect(built.body?.effects).toBeUndefined();
  });

  describe('«¿Qué pasa ahora?»', () => {
    const base = { party: 'other' as const, partyLabel: 'Mapfre', summary: 'Hablé' };
    it('lo envía al servidor junto a los efectos que lo respaldan', () => {
      expect(buildInteraction(form({ ...base, nextStep: 'resolved' }), NOW).body).toMatchObject({
        nextStep: 'resolved',
        effects: [{ type: 'resolve_issue' }],
      });
      expect(buildInteraction(form({ ...base, nextStep: 'route', newRoute: 'community_provider', routeReason: 'Rechazo' }), NOW).body?.effects).toEqual([
        { type: 'set_resolution_route', route: 'community_provider', reason: 'Rechazo' },
      ]);
      expect(buildInteraction(form({ ...base, nextStep: 'none' }), NOW).body).toMatchObject({ nextStep: 'none' });
    });

    it('cada opción exige sus datos', () => {
      const errors = (over: object) => buildInteraction(form({ ...base, ...over }), NOW).errors;
      expect(errors({ nextStep: 'task' })).toContain('Escribe qué hay que hacer.');
      expect(errors({ nextStep: 'wait' })).toContain('Indica a quién se espera.');
      expect(errors({ nextStep: 'visit' })).toContain('Indica la fecha de la visita o actuación.');
      expect(errors({ nextStep: 'route' })).toContain('Elige la nueva vía de gestión.');
    });

    it('la tarea lleva responsable y prioridad cuando se indican', () => {
      const effects = buildInteraction(
        form({ ...base, nextStep: 'task', followUpNote: 'Llamar', followUpMilestone: 'created', followUpAt: '2026-10-30T09:00', followUpAssigneeId: 'u1', followUpPriority: 'ALTA' }),
        NOW,
      ).body?.effects;
      expect(effects).toEqual([{ type: 'open_follow_up', note: 'Llamar', milestone: 'created', dueAt: new Date('2026-10-30T09:00').toISOString(), assigneeUserId: 'u1', priority: 'ALTA' }]);
    });

    it('resolver va siempre el último efecto', () => {
      const effects = buildInteraction(form({ ...base, nextStep: 'resolved', closeWaitId: 'w' }), NOW).body?.effects;
      expect(effects?.at(-1)).toEqual({ type: 'resolve_issue' });
    });
  });
});
