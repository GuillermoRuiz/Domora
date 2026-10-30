import type { Meeting } from '../prisma/client';
import JSZip from 'jszip';
import { ConvocatoriaDocxService } from './convocatoria-docx.service';

function meeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 'meeting-1',
    estateId: 'estate-1',
    title: 'Junta Ordinaria de Septiembre',
    type: 'ordinaria',
    status: 'convocada',
    scheduledAt1: new Date('2026-09-01T18:00:00Z'),
    scheduledAt2: new Date('2026-09-01T18:30:00Z'),
    agenda: [
      { id: 'a1', title: 'Aprobación de cuentas' },
      { id: 'a2', title: 'Renovación de la piscina' },
    ],
    convokedBy: 'presidente',
    location: 'Calle Ejemplo 1, Madrid',
    locationPlaceId: null,
    locationLat: null,
    locationLng: null,
    signerRole: 'administrador',
    signerName: 'Ana García',
    attendeeEmails: ['vecino@example.com'],
    includeJitsi: false,
    jitsiRoomName: null,
    jitsiAccessPassword: null,
    createdByUserId: 'user-1',
    createdAt: new Date('2026-08-01T00:00:00Z'),
    updatedAt: new Date('2026-08-01T00:00:00Z'),
    ...overrides,
  } as Meeting;
}

describe('ConvocatoriaDocxService', () => {
  const service = new ConvocatoriaDocxService();

  it('produce un .docx válido (cabecera ZIP)', async () => {
    const buffer = await service.generate(meeting());
    // Un .docx es un ZIP (Office Open XML): firma "PK\x03\x04".
    expect(buffer.subarray(0, 4).toString('latin1')).toBe('PK');
    expect(buffer.length).toBeGreaterThan(500);
  });

  it('no falla con una agenda vacía', async () => {
    const buffer = await service.generate(meeting({ agenda: [] }));
    expect(buffer.subarray(0, 2).toString('latin1')).toBe('PK');
  });

  it('no falla con un agenda malformado (no-array)', async () => {
    const buffer = await service.generate(meeting({ agenda: { not: 'an-array' } as unknown as Meeting['agenda'] }));
    expect(buffer.subarray(0, 2).toString('latin1')).toBe('PK');
  });

  it('imprime el texto editado por la gestora cuando la junta lo tiene guardado', async () => {
    const { default: JSZip } = await import('jszip').catch(() => ({ default: null as never }));
    const doc = { header: { community: 'Mi comunidad', title: 'Convocatoria Junta General Ordinaria' }, notice: 'Aviso propio', issuedLine: 'en Madrid a 1 de enero de 2027', greeting: 'Sr./a. Propietario/a:', intro: 'Texto de convocatoria personalizado.', agenda: [{ number: '01', text: 'Punto único' }], closing: 'Cierre propio.', signature: ['El administrador'], authorization: { enabled: false, text: '' } };
    const buffer = await service.generate(meeting({ convocatoriaDoc: doc as never }), { name: 'Otra' });
    expect(buffer.subarray(0, 2).toString('latin1')).toBe('PK');
    if (JSZip) {
      const xml = await (await JSZip.loadAsync(buffer)).file('word/document.xml')!.async('string');
      expect(xml).toContain('Texto de convocatoria personalizado.');
      expect(xml).toContain('Mi comunidad');
      expect(xml).not.toContain('Aprobación de cuentas');
    }
  });

  it('un texto guardado incompleto no tumba la descarga: se redacta el habitual', async () => {
    const broken = { header: { community: 'X', title: 'Y' }, intro: 'Solo esto' };
    const resolved = service.resolveDocument(meeting({ convocatoriaDoc: broken as never }), { name: 'CDAD' });
    expect(resolved.header.community).toBe('CDAD');
    const buffer = await service.generate(meeting({ convocatoriaDoc: broken as never }), { name: 'CDAD' });
    expect(buffer.subarray(0, 2).toString('latin1')).toBe('PK');
  });

  it('sin texto guardado redacta el habitual con los datos de la junta y de la finca', async () => {
    const resolved = service.resolveDocument(meeting(), { name: 'CDAD PROP EJEMPLO', location: 'Madrid' });
    expect(resolved.header.community).toBe('CDAD PROP EJEMPLO');
    expect(resolved.agenda.map((line) => line.text)).toEqual(['Aprobación de cuentas', 'Renovación de la piscina']);
    expect(resolved.intro).toContain('Calle Ejemplo 1, Madrid');
  });

  describe('autorización para delegar el voto', () => {
    const base = { header: { community: 'Mi comunidad', title: 'Convocatoria' }, notice: '', issuedLine: '', greeting: '', intro: 'Texto.', agenda: [{ number: '01', text: 'Punto' }], closing: 'Cierre.', signature: ['El administrador'] };
    const documentXml = async (authorization: { enabled: boolean; text: string }, agendaLines = 1) => {
      const agenda = Array.from({ length: agendaLines }, (_, i) => ({ number: String(i + 1).padStart(2, '0'), text: `Punto ${i + 1}` }));
      const buffer = await service.generate(meeting({ convocatoriaDoc: { ...base, agenda, authorization } as never }));
      return (await JSZip.loadAsync(buffer)).file('word/document.xml')!.async('string');
    };

    it('va en un marco anclado al borde inferior de la página, con independencia del contenido', async () => {
      for (const lines of [1, 60]) {
        const xml = await documentXml({ enabled: true, text: 'Ante la imposibilidad de asistir.' }, lines);
        const frames = xml.match(/<w:framePr [^>]*\/>/g) ?? [];
        // ✂, texto, D/Dª, Atentamente, Firmado, Propietario del
        expect(frames).toHaveLength(6);
        expect(new Set(frames).size).toBe(1);
        expect(frames[0]).toContain('w:yAlign="bottom"');
        expect(frames[0]).toContain('w:vAnchor="margin"');
        // El marco va al final del documento, tras la firma.
        expect(xml.indexOf('El administrador')).toBeLessThan(xml.indexOf('w:framePr'));
        expect(xml.indexOf('Ante la imposibilidad')).toBeGreaterThan(xml.indexOf('w:framePr'));
      }
    });

    it('sin autorización no hay marco', async () => {
      expect(await documentXml({ enabled: false, text: '' })).not.toContain('w:framePr');
    });
  });
});
