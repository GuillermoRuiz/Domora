import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { buildDefaultConvocatoria, formatConvocatoriaDate, formatConvocatoriaTime, type ConvocatoriaInput } from './convocatoria-document';
import { ConvocatoriaDocumentDto } from './dto/create-meeting.dto';

const input = (over: Partial<ConvocatoriaInput> = {}): ConvocatoriaInput => ({
  communityName: 'CDAD PROP SORZANO 17-31 MADRID',
  communityLocation: 'Madrid',
  type: 'extraordinaria',
  convokedBy: 'presidente',
  // 14 sept 2026, 19:00 y 19:30 hora de Madrid (CEST = UTC+2).
  scheduledAt1: new Date('2026-09-14T17:00:00Z'),
  scheduledAt2: new Date('2026-09-14T17:30:00Z'),
  location: 'Jardín piscina',
  agenda: [
    { id: 'a1', title: 'Aceptación de la dimisión del presidente' },
    { id: 'a2', title: '  ' },
    { id: 'a3', title: 'Actuaciones en piscina', description: 'ignorada' },
  ],
  signerRole: 'secretario',
  signerName: 'Fernando Gil Arrufat',
  issuedAt: new Date('2026-09-09T10:00:00Z'),
  ...over,
});

describe('buildDefaultConvocatoria', () => {
  it('redacta la convocatoria habitual: cabecera, aviso, fecha de emisión, convocatoria, orden del día y firma', () => {
    const doc = buildDefaultConvocatoria(input());
    expect(doc.header).toEqual({ community: 'CDAD PROP SORZANO 17-31 MADRID', title: 'Convocatoria Junta General Extraordinaria' });
    expect(doc.notice).toContain('recibirán la convocatoria por dicha vía');
    expect(doc.issuedLine).toBe('en Madrid a 9 de septiembre de 2026');
    expect(doc.greeting).toBe('Sr./a. Propietario/a:');
    expect(doc.intro).toBe(
      'Siguiendo instrucciones del Sr. Presidente de la Comunidad y de conformidad con lo dispuesto en el artículo 16.2 de la vigente Ley de Propiedad Horizontal, ' +
        'por la presente se le convoca para que asista a la Junta General Extraordinaria que se celebrará el próximo día 14 de septiembre de 2026 a las 19:00 horas ' +
        'en primera convocatoria, o de no concurrir el quórum necesario, a las 19:30 horas en segunda, en Jardín piscina, con el fin de tratar el siguiente:',
    );
    expect(doc.agenda).toEqual([
      { number: '01', text: 'Aceptación de la dimisión del presidente' },
      { number: '02', text: 'Actuaciones en piscina' },
    ]);
    expect(doc.signature).toEqual(['El secretario', 'Fernando Gil Arrufat']);
    expect(doc.authorization.enabled).toBe(true);
    expect(doc.authorization.text).toContain('Sr. Presidente de la Comunidad de Propietarios CDAD PROP SORZANO 17-31 MADRID');
    expect(doc.authorization.text).toContain('para el próximo 14 de septiembre de 2026');
  });

  it('indica el día de la 2ª convocatoria cuando no es el mismo, y omite lugar y localidad si faltan', () => {
    const doc = buildDefaultConvocatoria(input({ scheduledAt2: new Date('2026-09-15T17:30:00Z'), location: null, communityLocation: null }));
    expect(doc.intro).toContain('a las 19:30 horas en segunda del día 15 de septiembre de 2026, con el fin de tratar el siguiente:');
    expect(doc.intro).not.toContain(', en ');
    expect(doc.issuedLine).toBe('a 9 de septiembre de 2026');
  });

  it.each([
    ['cuotas25', 'A petición de propietarios que representan al menos el 25 % de las cuotas de participación'],
    ['propietarios25', 'A petición de la cuarta parte de los propietarios'],
    ['mandatoJudicial', 'Por mandato judicial'],
  ] as const)('adapta el encabezado del párrafo cuando convoca «%s»', (convokedBy, expected) => {
    expect(buildDefaultConvocatoria(input({ convokedBy })).intro.startsWith(expected)).toBe(true);
  });

  it('usa la hora de Madrid también en horario de invierno', () => {
    expect(formatConvocatoriaTime(new Date('2026-01-20T17:00:00Z'))).toBe('18:00');
    expect(formatConvocatoriaDate(new Date('2026-01-20T23:30:00Z'))).toBe('21 de enero de 2026');
  });

  it('sin nombre de firmante, la firma es solo el cargo; una agenda malformada da cero puntos', () => {
    const doc = buildDefaultConvocatoria(input({ signerRole: 'administrador', signerName: ' ', agenda: { no: 'array' } }));
    expect(doc.signature).toEqual(['El administrador']);
    expect(doc.agenda).toEqual([]);
  });
});

describe('ConvocatoriaDocumentDto', () => {
  const valid = () => ({ ...buildDefaultConvocatoria(input()) });
  const errors = (plain: unknown) => validate(plainToInstance(ConvocatoriaDocumentDto, plain), { whitelist: true, forbidNonWhitelisted: true });

  it('acepta el documento redactado por defecto', async () => {
    expect(await errors(valid())).toHaveLength(0);
  });

  it('rechaza campos desconocidos y textos desmesurados', async () => {
    expect(await errors({ ...valid(), extra: 1 })).not.toHaveLength(0);
    expect(await errors({ ...valid(), intro: 'x'.repeat(4001) })).not.toHaveLength(0);
    expect(await errors({ ...valid(), signature: new Array(11).fill('x') })).not.toHaveLength(0);
  });
});
