import {
  MANUAL_REQUESTER_TEMPLATES,
  REQUESTER_TEMPLATES,
  renderRequesterMessage,
} from './requester-messages';

/** Lo que se le comunica al solicitante sale SOLO de plantillas con datos estructurados: nada de texto libre del modelo. */
describe('renderRequesterMessage', () => {
  it('visita programada: fecha y hora en Madrid', () => {
    const message = renderRequesterMessage('visit_scheduled', {
      when: '2026-10-29T08:00:00.000Z',
    });
    expect(message.title).toBe('Visita programada');
    expect(message.body).toBe(
      'Se ha programado una visita para revisar tu incidencia: jueves, 29 de octubre de 2026, 9:00.',
    );
  });

  it('tercero contactado y a la espera, con el nombre que se le presenta al solicitante', () => {
    expect(
      renderRequesterMessage('third_party_contacted', { label: 'el seguro' })
        .body,
    ).toBe('Hemos contactado con el seguro para gestionar tu incidencia.');
    expect(
      renderRequesterMessage('waiting_third_party', { label: 'Mapfre' }).body,
    ).toBe('Seguimos esperando la respuesta de Mapfre sobre tu incidencia.');
  });

  it('incidencia resuelta no necesita datos', () => {
    expect(renderRequesterMessage('issue_resolved', {}).title).toBe(
      'Incidencia resuelta',
    );
  });

  it('sin los datos que exige la plantilla no se renderiza (no se inventa una fecha ni un nombre)', () => {
    expect(() => renderRequesterMessage('visit_scheduled', {})).toThrow(
      'REQUESTER_TEMPLATE_PARAMS_MISSING',
    );
    expect(() =>
      renderRequesterMessage('visit_scheduled', { when: 'mañana' }),
    ).toThrow('REQUESTER_TEMPLATE_PARAMS_MISSING');
    expect(() => renderRequesterMessage('third_party_contacted', {})).toThrow(
      'REQUESTER_TEMPLATE_PARAMS_MISSING',
    );
  });

  it('el mensaje escrito por la gestión se envía tal cual, recortado y sin espacios de más', () => {
    const message = renderRequesterMessage('custom', {
      text: '  Mañana pasa el técnico.\nAvísanos si no estás.  ',
    });
    expect(message.title).toBe('Mensaje sobre tu incidencia');
    expect(message.body).toBe('Mañana pasa el técnico.\nAvísanos si no estás.');
    expect(
      renderRequesterMessage('custom', { text: 'x'.repeat(900) }).body,
    ).toHaveLength(500);
    expect(() => renderRequesterMessage('custom', { text: '   ' })).toThrow(
      'REQUESTER_TEMPLATE_PARAMS_MISSING',
    );
    expect(() => renderRequesterMessage('custom', {})).toThrow(
      'REQUESTER_TEMPLATE_PARAMS_MISSING',
    );
  });

  it('el texto libre solo lo puede enviar una persona: no está entre las plantillas de Domora', () => {
    expect(REQUESTER_TEMPLATES as readonly string[]).not.toContain('custom');
    expect(MANUAL_REQUESTER_TEMPLATES as readonly string[]).toContain('custom');
  });

  it('cada plantilla del catálogo se puede renderizar con sus datos', () => {
    for (const template of REQUESTER_TEMPLATES) {
      const message = renderRequesterMessage(template, {
        when: '2026-10-29T08:00:00.000Z',
        label: 'X',
      });
      expect(message.title).toBeTruthy();
      expect(message.body).toBeTruthy();
    }
  });
});
