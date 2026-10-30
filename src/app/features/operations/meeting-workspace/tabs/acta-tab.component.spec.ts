import { setupComponent, settle } from '../../../../core/testing/component-harness';
import { MeetingsService } from '../../../../core/meetings.service';
import { ConfirmDialogService } from '../../../../shared/components/confirm-dialog/confirm-dialog.service';
import type { ActaSigning, ActaState, ActaValidation } from '../../../../core/acta.models';
import { actaValidation, actaVersion } from '../acta-viewer/acta-fixtures';
import type { ActaVersion, Meeting } from '../../../../core/models';
import type { ActaStatus, AgendaRow, ParticipationRow, ParticipationStats, Signer } from '../meeting-workspace.model';
import { MeetingActaTabComponent } from './acta-tab.component';

const meeting = (over: Partial<Meeting> = {}) =>
  ({
    id: 'm1',
    status: 'celebrada',
    scheduledAt1: '2026-10-14T19:00:00Z',
    scheduledAt2: '2026-10-14T19:30:00Z',
    updatedAt: '2026-10-14T12:30:00Z',
    celebratedAt: '2026-10-14T12:30:00Z',
    location: 'Portal de la comunidad',
    ...over,
  }) as Meeting;

const status: ActaStatus = { phase: 'pending-signature', tone: 'yellow', label: 'Pendiente de firma', hint: '' };
const stats = {
  attending: 21,
  totalOwners: 34,
  represented: 2,
  ownersPercent: 61.8,
  quotaPercent: 61.9,
  quorumTone: 'green',
  quorumLabel: 'Quórum alcanzado',
  quorumHint: 'Se ha alcanzado el quórum necesario para la celebración de la junta.',
} as ParticipationStats;

const participant = (propertyId: string, unit: string, group: string, state: ParticipationRow['status'], quotaValue = 2.5) =>
  ({ propertyId, unit, group, status: state, quotaValue, quota: `${quotaValue}%` }) as ParticipationRow;

const point = (over: Partial<AgendaRow> = {}): AgendaRow =>
  ({
    id: 'a1',
    number: '01',
    title: 'Aprobación del acta anterior',
    tone: 'green',
    statusLabel: 'Completado',
    hint: 'Votación finalizada',
    result: { label: 'Aprobado', tone: 'green' },
    tally: [
      { label: 'A favor', count: 11, tone: 'green' },
      { label: 'En contra', count: 5, tone: 'red' },
      { label: 'Abstención', count: 0, tone: 'muted' },
    ],
    votable: true,
    comments: '',
    canComment: true,
    ...over,
  }) as AgendaRow;

const version = (versionNumber: number, over: Partial<ActaVersion> = {}): ActaVersion => ({
  id: `v${versionNumber}`,
  versionNumber,
  createdAt: '2026-10-14T10:30:00Z',
  savedByName: 'Ana Gestora',
  generalComments: null,
  nextSteps: null,
  pointComments: [{ id: 'a1', title: 'Aprobación del acta anterior', comments: '' }],
  ...over,
});

const noSigning: ActaSigning = { readyForSignature: false, presidenteSigned: false, secretarioSigned: false, canSign: { presidente: false, secretario: false } };
const noActa: ActaState = { version: null, legacy: { signed: false, hasDocx: false } };

function setup(
  over: { meeting?: Meeting; signers?: Signer[]; rows?: ParticipationRow[]; agenda?: AgendaRow[]; versions?: ActaVersion[]; acta?: ActaState; validation?: ActaValidation; signing?: ActaSigning } = {},
) {
  const api = {
    listActaVersions: vi.fn().mockResolvedValue(over.versions ?? []),
    listActaDocumentVersions: vi.fn().mockResolvedValue([
      { id: 'v3', versionNumber: 3, status: 'draft', statusLabel: 'Borrador', createdAt: '2026-10-14T21:30:00Z', savedByName: 'Ana' },
      { id: 'v2', versionNumber: 2, status: 'superseded', statusLabel: 'Sustituida', createdAt: '2026-10-14T20:30:00Z', savedByName: 'Ana' },
    ]),
    getActaDocumentVersion: vi.fn().mockResolvedValue(actaVersion({ id: 'v2', versionNumber: 2, status: 'superseded', statusLabel: 'Sustituida', editable: false })),
    saveActaVersion: vi.fn().mockResolvedValue(version(1)),
    getActa: vi.fn().mockResolvedValue(over.acta ?? noActa),
    validateActa: vi.fn().mockResolvedValue(over.validation ?? actaValidation()),
    generateActa: vi.fn().mockResolvedValue(actaVersion()),
    saveActaEdits: vi.fn().mockResolvedValue(actaVersion({ id: 'v4', versionNumber: 4 })),
    getActaSigning: vi.fn().mockResolvedValue(over.signing ?? noSigning),
    signActaAsSelf: vi.fn().mockResolvedValue(meeting({ actaSignedByPresidenteUserId: 'u1' })),
    syncActaNotes: vi.fn().mockResolvedValue(actaVersion({ id: 'v6', versionNumber: 6 })),
    regenerateActaNarrative: vi.fn().mockResolvedValue(actaVersion({ id: 'v5', versionNumber: 5 })),
    uploadActa: vi.fn().mockResolvedValue({ origin: 'uploaded', upload: null, version: null, legacy: { signed: false, hasDocx: false } }),
    prepareActaForSignature: vi.fn().mockResolvedValue(actaVersion({ status: 'readyForSignature', statusLabel: 'Lista para firma', hasPdf: true })),
  };
  const h = setupComponent(MeetingActaTabComponent, { providers: [{ provide: MeetingsService, useValue: api }] });
  h.fixture.componentRef.setInput('meeting', over.meeting ?? meeting());
  h.fixture.componentRef.setInput('status', status);
  h.fixture.componentRef.setInput('signers', over.signers ?? [{ role: 'Presidente', signed: false }, { role: 'Secretario / Administrador', signed: false }]);
  h.fixture.componentRef.setInput('stats', stats);
  h.fixture.componentRef.setInput('rows', over.rows ?? []);
  h.fixture.componentRef.setInput('agenda', over.agenda ?? [point()]);
  h.fixture.componentRef.setInput('typeLabel', 'Ordinaria');
  h.fixture.detectChanges();
  return Object.assign(h, { api });
}
/** Espera a que se cargue el histórico de versiones. */
async function ready(over: Parameters<typeof setup>[0] = {}) {
  const h = setup(over);
  await settle();
  h.fixture.detectChanges();
  return h;
}
const text = (h: ReturnType<typeof setup>) => (h.el.textContent ?? '').replace(/\s+/g, ' ');
const noteButtons = (h: ReturnType<typeof setup>) =>
  (Array.from(h.el.querySelectorAll('.agreements .point__comment app-btn button, app-meeting-card[title="Observaciones"] .point__comment app-btn button')) as HTMLButtonElement[]).filter((b) => b.textContent?.trim() === 'Editar');
const button = (h: ReturnType<typeof setup>, label: string) =>
  Array.from(h.el.querySelectorAll('button')).find((b) => b.textContent?.includes(label)) as HTMLButtonElement;

describe('MeetingActaTabComponent', () => {
  it('no repite la información de la junta: sin tarjeta de cabecera, solo la fila de acciones y el proceso de firma', () => {
    const h = setup();
    expect(h.el.querySelector('.head')).toBeNull();
    expect(text(h)).not.toContain('Acta de la junta ordinaria');
    expect(text(h)).not.toContain('1ª convocatoria');
    expect(text(h)).not.toContain('Portal de la comunidad');
    expect(text(h)).toContain('Borrador actual');
    expect(text(h)).toContain('Proceso de firma');
  });

  describe('modo del acta: generar en Domora o subir un acta existente', () => {
    const file = (name = 'acta.pdf', type = 'application/pdf', size = 2048) => {
      const f = new File(['x'], name, { type });
      Object.defineProperty(f, 'size', { value: size });
      return f;
    };
    const modeButton = (h: ReturnType<typeof setup>, label: string) =>
      Array.from(h.el.querySelectorAll('.mode__option')).find((b) => b.textContent?.includes(label)) as HTMLButtonElement;
    const pick = (h: ReturnType<typeof setup>, f: File) => {
      const input = h.el.querySelector('input[type="file"]') as HTMLInputElement;
      Object.defineProperty(input, 'files', { value: [f], configurable: true });
      input.dispatchEvent(new Event('change'));
      h.fixture.detectChanges();
    };
    const submitButton = (h: ReturnType<typeof setup>) => h.el.querySelector('app-btn.submit button') as HTMLButtonElement;

    it('muestra dos modos como un selector segmentado y empieza en «Generar en Domora»', () => {
      const h = setup();
      const options = Array.from(h.el.querySelectorAll('.mode__option')).map((o) => o.textContent?.trim());
      expect(options).toEqual(['Generar en Domora', 'Subir acta existente']);
      expect(modeButton(h, 'Generar en Domora').classList).toContain('mode__option--active');
      expect(modeButton(h, 'Subir acta existente').getAttribute('aria-pressed')).toBe('false');
    });

    it('en «Generar» la fila de acciones lleva Versión y Guardar a la izquierda, y Revisar y ··· a la derecha', () => {
      const h = setup();
      const bar = h.el.querySelector('.toolbar') as HTMLElement;
      const left = bar.querySelector('.version') as HTMLElement;
      const right = bar.querySelector('.toolbar__actions') as HTMLElement;
      expect(left.textContent).toContain('Versión');
      expect(left.textContent).toContain('Guardar');
      expect(right.textContent).toContain('Revisar');
      expect(right.querySelector('[aria-label="Más acciones del acta"]')).not.toBeNull();
    });

    it('«Subir acta existente» cambia el contenido: la tarjeta de subida en lugar del acta generada', () => {
      const h = setup();
      modeButton(h, 'Subir acta existente').click();
      h.fixture.detectChanges();
      expect(h.component.mode()).toBe('uploaded');
      expect(modeButton(h, 'Subir acta existente').classList).toContain('mode__option--active');
      expect(modeButton(h, 'Generar en Domora').classList).not.toContain('mode__option--active');
      expect(text(h)).toContain('Arrastra aquí el acta o selecciónala desde tu equipo');
      expect(text(h)).toContain('Formatos admitidos: PDF y DOCX');
      expect(text(h)).toContain('Seleccionar archivo');
      expect(text(h)).toContain('El acta subida sustituirá al borrador generado en Domora.');
      expect(h.el.querySelector('.toolbar')).toBeNull();
      expect(text(h)).not.toContain('Proceso de firma');
    });

    it('cambiar de modo no destruye nada: textos sin guardar y archivo elegido siguen ahí', async () => {
      const h = await ready({ versions: [version(1)] });
      h.component.editing.set({ kind: 'general' });
      h.component.stage('Texto sin guardar');
      h.fixture.detectChanges();
      modeButton(h, 'Subir acta existente').click();
      h.fixture.detectChanges();
      pick(h, file());
      modeButton(h, 'Generar en Domora').click();
      h.fixture.detectChanges();
      expect(h.component.general()).toBe('Texto sin guardar');
      expect(h.component.dirty()).toBe(true);
      expect(text(h)).toContain('Cambios sin guardar');
      expect(h.api.saveActaVersion).not.toHaveBeenCalled();
      modeButton(h, 'Subir acta existente').click();
      h.fixture.detectChanges();
      expect(text(h)).toContain('acta.pdf');
    });

    it('acepta PDF y DOCX, y rechaza otros tipos explicando por qué', () => {
      const h = setup();
      modeButton(h, 'Subir acta existente').click();
      h.fixture.detectChanges();
      pick(h, file('acta.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'));
      expect(h.component.uploadFile()?.name).toBe('acta.docx');
      pick(h, file('foto.png', 'image/png'));
      expect(h.component.uploadFile()?.name).toBe('acta.docx');
      expect(text(h)).toContain('«foto.png»: solo se admiten PDF y DOCX.');
    });

    const dialogEl = () => document.body.querySelector('app-acta-upload-dialog') as HTMLElement | null;
    const choice = (index: number) => dialogEl()!.querySelectorAll('[role="radio"]')[index] as HTMLButtonElement;
    const dialogButton = (label: string) => Array.from(dialogEl()!.querySelectorAll('.modal__footer button')).find((b) => b.textContent?.includes(label)) as HTMLButtonElement;
    const uploadedState = (over: Partial<ActaState> = {}): ActaState => ({
      origin: 'uploaded',
      upload: { fileName: 'acta-firmada.pdf', mimeType: 'application/pdf', sizeBytes: 2048, sha256: 'ab12cd34ef56'.padEnd(64, '0'), uploadedAt: '2026-10-15T10:00:00Z' },
      version: null,
      legacy: { signed: false, hasDocx: false },
      ...over,
    });
    const openDialog = async (over: Parameters<typeof setup>[0] = {}) => {
      const h = await ready(over);
      modeButton(h, 'Subir acta existente').click();
      h.fixture.detectChanges();
      pick(h, file());
      submitButton(h).click();
      h.fixture.detectChanges();
      return h;
    };

    it('«Subir acta» pregunta primero si el acta ya está firmada, sin ninguna opción preseleccionada', async () => {
      const h = await openDialog();
      expect(dialogEl()).not.toBeNull();
      expect(dialogEl()!.textContent).toContain('¿Esta acta ya está firmada?');
      expect(dialogEl()!.textContent).toContain('acta.pdf');
      expect(choice(0).getAttribute('aria-checked')).toBe('false');
      expect(choice(1).getAttribute('aria-checked')).toBe('false');
      expect(dialogButton('Subir acta').disabled).toBe(true);
      expect(h.api.uploadActa).not.toHaveBeenCalled();
    });

    it('«Sí, ya está firmada» sube el archivo como firmado, actualiza el estado y avisa a la pantalla', async () => {
      const h = await openDialog();
      h.api.uploadActa.mockResolvedValueOnce(uploadedState());
      const saved = vi.fn();
      h.component.saved.subscribe(saved);
      choice(0).click();
      h.fixture.detectChanges();
      dialogButton('Subir acta').click();
      await settle();
      h.fixture.detectChanges();
      expect(h.api.uploadActa).toHaveBeenCalledWith('m1', expect.objectContaining({ name: 'acta.pdf' }), true);
      expect(saved).toHaveBeenCalledWith('Acta subida: la junta queda firmada.');
      expect(h.component.uploadFile()).toBeNull();
      expect(dialogEl()).toBeNull();
      expect(text(h)).toContain('acta-firmada.pdf');
    });

    it('«No, falta firmarla» sube el archivo como pendiente de firma', async () => {
      const h = await openDialog();
      h.api.uploadActa.mockResolvedValueOnce(uploadedState());
      const saved = vi.fn();
      h.component.saved.subscribe(saved);
      choice(1).click();
      h.fixture.detectChanges();
      dialogButton('Subir acta').click();
      await settle();
      expect(h.api.uploadActa).toHaveBeenCalledWith('m1', expect.anything(), false);
      expect(saved).toHaveBeenCalledWith('Acta subida: pendiente de firma.');
    });

    it('cancelar el diálogo no sube nada y conserva el archivo elegido', async () => {
      const h = await openDialog();
      dialogButton('Cancelar').click();
      h.fixture.detectChanges();
      expect(dialogEl()).toBeNull();
      expect(h.api.uploadActa).not.toHaveBeenCalled();
      expect(h.component.uploadFile()?.name).toBe('acta.pdf');
    });

    it('si el servidor rechaza la subida, lo dice en el diálogo y no lo cierra', async () => {
      const h = await openDialog();
      h.api.uploadActa.mockRejectedValueOnce({ error: { message: 'El acta ya tiene firmas puestas.' } });
      choice(1).click();
      h.fixture.detectChanges();
      dialogButton('Subir acta').click();
      await settle();
      h.fixture.detectChanges();
      expect(dialogEl()!.textContent).toContain('El acta ya tiene firmas puestas.');
      expect(h.component.uploadFile()).not.toBeNull();
    });

    it('con un acta ya generada, el diálogo avisa de que el archivo sustituye al borrador (que se conserva)', async () => {
      await openDialog({ acta: { ...noActa, version: actaVersion() } });
      expect(dialogEl()!.textContent).toContain('sustituye al borrador generado en Domora');
      expect(dialogEl()!.textContent).toContain('se conservan');
    });

    it('sin acta generada no hay borrador que sustituir y no se avisa', async () => {
      await openDialog();
      expect(dialogEl()!.textContent).not.toContain('sustituye al borrador');
    });

    it.each([
      ['la junta aún no está celebrada', { status: 'convocada' }, 'Podrás subir el acta cuando la junta esté celebrada.'],
      ['el acta ya está firmada', { status: 'firmada' }, 'El acta ya está firmada: no se puede sustituir.'],
      ['la junta está cancelada', { status: 'cancelada' }, 'La junta está cancelada: no tiene acta.'],
    ])('no se puede subir si %s', async (_label, over, reason) => {
      const h = await ready({ meeting: meeting(over as Partial<Meeting>) });
      modeButton(h, 'Subir acta existente').click();
      h.fixture.detectChanges();
      pick(h, file());
      expect(submitButton(h).disabled).toBe(true);
      expect(text(h)).toContain(reason);
    });

    it('con una firma ya puesta no se puede sustituir el archivo', async () => {
      const h = await ready({ signers: [{ role: 'Presidente', signed: true }, { role: 'Secretario / Administrador', signed: false }] });
      modeButton(h, 'Subir acta existente').click();
      h.fixture.detectChanges();
      expect(text(h)).toContain('El acta ya tiene firmas: no se puede sustituir el archivo.');
    });

    describe('con un acta subida', () => {
      it('abre en ese modo y enseña el archivo (nombre, tamaño, huella), el proceso de firma y no la zona de subida', async () => {
        const h = await ready({ acta: uploadedState() });
        expect(h.component.mode()).toBe('uploaded');
        expect(text(h)).toContain('Acta subida');
        expect(text(h)).toContain('acta-firmada.pdf');
        expect(text(h)).toContain('2 KB');
        expect(text(h)).toContain('SHA-256 ab12cd34');
        expect(text(h)).toContain('Proceso de firma');
        expect(h.el.querySelector('app-meeting-acta-upload-card')).toBeNull();
      });

      it('el proceso de firma arranca con «Acta subida» y «Enviada a firma» ya hechos', async () => {
        const h = await ready({ acta: uploadedState() });
        expect(Array.from(h.el.querySelectorAll('.step')).map((el) => [el.querySelector('strong')?.textContent, el.className.match(/step--(\w+)/)?.[1]])).toEqual([
          ['Acta subida', 'done'],
          ['Enviada a firma', 'done'],
          ['Presidente firmado', 'current'],
          ['Secretario firmado', 'todo'],
          ['Acta definitiva', 'todo'],
        ]);
      });

      it('«Descargar» pide el archivo con su nombre', async () => {
        const h = await ready({ acta: uploadedState() });
        const downloaded = vi.fn();
        h.component.downloadUpload.subscribe(downloaded);
        button(h, 'Descargar').click();
        expect(downloaded).toHaveBeenCalledWith('acta-firmada.pdf');
      });

      it('«Subir otro archivo» enseña la zona de subida mientras nadie haya firmado', async () => {
        const h = await ready({ acta: uploadedState() });
        button(h, 'Subir otro archivo').click();
        h.fixture.detectChanges();
        expect(h.el.querySelector('app-meeting-acta-upload-card')).not.toBeNull();
        button(h, 'Cancelar').click();
        h.fixture.detectChanges();
        expect(h.el.querySelector('app-meeting-acta-upload-card')).toBeNull();
      });

      it('con el acta firmada no se ofrece subir otro archivo, y el menú descarga el archivo subido', async () => {
        const h = await ready({ acta: uploadedState(), meeting: meeting({ status: 'firmada' }), signers: [{ role: 'Presidente', signed: true }, { role: 'Secretario / Administrador', signed: true }] });
        h.fixture.componentRef.setInput('status', { phase: 'signed', tone: 'green', label: 'Firmada', hint: '' });
        h.fixture.detectChanges();
        expect(text(h)).not.toContain('Subir otro archivo');
        const downloaded = vi.fn();
        const legacy = vi.fn();
        h.component.downloadUpload.subscribe(downloaded);
        h.component.download.subscribe(legacy);
        h.component.choose('download');
        expect(downloaded).toHaveBeenCalledWith('acta-firmada.pdf');
        expect(legacy).not.toHaveBeenCalled();
      });

      it('en «Generar en Domora» avisa de que lo que se firma es el archivo subido', async () => {
        const h = await ready({ acta: uploadedState() });
        modeButton(h, 'Generar en Domora').click();
        h.fixture.detectChanges();
        expect(text(h)).toContain('El acta que se firma es el archivo subido (acta-firmada.pdf)');
      });
    });

    it('si el servidor dice que el acta es subida, abre directamente ese modo', async () => {
      const h = await ready({ acta: uploadedState() });
      expect(h.component.mode()).toBe('uploaded');
    });

    it('la elección manual de modo no la pisa lo que llegue del servidor', async () => {
      const h = setup({ acta: uploadedState() });
      modeButton(h, 'Generar en Domora').click();
      await settle();
      expect(h.component.mode()).toBe('generated');
    });
  });

  const stepsOf = (h: ReturnType<typeof setup>) =>
    Array.from(h.el.querySelectorAll('.step')).map((el) => [el.querySelector('strong')?.textContent, el.className.match(/step--(\w+)/)?.[1]]);

  it('a held meeting without an acta yet is still at "Crear acta" (it does not skip to the signatures)', async () => {
    const h = await ready();
    expect(stepsOf(h)).toEqual([
      ['Crear acta', 'current'],
      ['Enviada a firma', 'todo'],
      ['Presidente firmado', 'todo'],
      ['Secretario firmado', 'todo'],
      ['Acta definitiva', 'todo'],
    ]);
  });

  it('with the acta created but not prepared, "Enviada a firma" is the current step', async () => {
    const h = await ready({ acta: { version: actaVersion({ status: 'draft' }), legacy: { signed: false, hasDocx: false } } });
    expect(stepsOf(h).slice(0, 3)).toEqual([
      ['Crear acta', 'done'],
      ['Enviada a firma', 'current'],
      ['Presidente firmado', 'todo'],
    ]);
  });

  it('once prepared for signature, the president is the next step', async () => {
    const h = await ready({ acta: { version: actaVersion({ status: 'readyForSignature' }), legacy: { signed: false, hasDocx: false } } });
    expect(stepsOf(h).slice(0, 3)).toEqual([
      ['Crear acta', 'done'],
      ['Enviada a firma', 'done'],
      ['Presidente firmado', 'current'],
    ]);
  });

  it('walks the signing process: the first step still to do is the current one', () => {
    const h = setup({ signers: [{ role: 'Presidente', signed: true }, { role: 'Secretario / Administrador', signed: false }] });
    const steps = stepsOf(h);
    expect(steps).toEqual([
      ['Crear acta', 'done'],
      ['Enviada a firma', 'done'],
      ['Presidente firmado', 'done'],
      ['Secretario firmado', 'current'],
      ['Acta definitiva', 'todo'],
    ]);
    expect(text(h)).toContain('1/2 completadas');
  });

  it('before the meeting is held the draft is the current step', () => {
    const h = setup({ meeting: meeting({ status: 'convocada', celebratedAt: null }) });
    expect(h.el.querySelector('.step--current strong')?.textContent).toBe('Crear acta');
    expect(h.el.querySelector('.step--done')).toBeNull();
  });

  it('shows the attendance metrics and the present properties grouped by building with their coefficient', () => {
    const h = setup({
      rows: [
        participant('p1', '1-A', 'A', 'presente'),
        participant('p2', '1-B', 'A', 'representado', 3),
        participant('p3', '2-A', 'A', 'ausente'),
        participant('p4', '1-A', 'B', 'ausente'),
        participant('p5', '3-C', 'C', 'presente', 1),
      ],
    });
    const metrics = Array.from(h.el.querySelectorAll('.metrics > div')).map((el) => [el.querySelector('dt')?.textContent, el.querySelector('dd')?.textContent?.replace(/\s+/g, ' ').trim()]);
    expect(metrics).toEqual([
      ['Propietarios asistentes', '21 / 34'],
      ['Vecinos presentes', '61,8%'],
      ['Coeficiente presente', '61,9%'],
    ]);
    expect(text(h)).toContain('Quórum alcanzado');
    const groups = Array.from(h.el.querySelectorAll('.group header')).map((header) =>
      Array.from(header.children).map((child) => child.textContent?.trim()),
    );
    expect(groups).toEqual([
      ['Edificio A', '2 de 3', '5,5%'],
      ['Edificio C', '1 de 1', '1%'],
    ]);
    expect(text(h)).not.toContain('2-A');
  });

  it('shows each point with its result, a bar and the counts; a point without a vote says so', () => {
    const h = setup({
      agenda: [
        point(),
        point({ id: 'a2', number: '02', title: 'Ruegos y preguntas', votable: false, result: null, tally: [], statusLabel: 'Tratado', tone: 'muted' }),
      ],
    });
    const points = Array.from(h.el.querySelectorAll('.point'));
    expect(points[0].textContent).toContain('Aprobación del acta anterior');
    expect(points[0].textContent).toContain('Aprobado');
    expect(points[0].textContent).toContain('11 a favor (68,8%) · 5 en contra (31,3%) · 0 abstenciones (0%)');
    expect(points[0].querySelectorAll('.bar__seg').length).toBe(2);
    expect(points[1].textContent).toContain('Tratado');
    expect(points[1].textContent).toContain('Sin votación');
    expect(points[1].querySelector('.bar')).toBeNull();
  });

  it('shows the comment of a point and opens its editor', () => {
    const h = setup({ agenda: [point({ comments: 'Se aprueba con una reserva.' })] });
    expect(text(h)).toContain('Se aprueba con una reserva.');
    (h.el.querySelector('.point__comment app-btn button') as HTMLButtonElement).click();
    h.fixture.detectChanges();
    expect(h.component.editing()).toMatchObject({ kind: 'point', row: { id: 'a1' } });
    expect(h.component.dialog()?.target).toMatchObject({ number: '01', comments: 'Se aprueba con una reserva.' });
  });

  it('cannot edit the comment of a point when comments are closed', () => {
    const h = setup({ agenda: [point({ canComment: false })] });
    expect((h.el.querySelector('.point__comment app-btn button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('goes to the agenda from "Gestionar orden del día"', () => {
    const h = setup();
    const manage = vi.fn();
    h.component.manageAgenda.subscribe(manage);
    button(h, 'Gestionar orden del día').click();
    expect(manage).toHaveBeenCalled();
  });

  it('shows the observations, the agreements and the actions derived from them, each text with an Editar button', async () => {
    const h = await ready({
      meeting: meeting({ actaGeneralComments: 'Sin incidencias.', actaNextSteps: 'Pedir 3 presupuestos.\n\nRevisar la iluminación.' }),
      acta: { version: actaVersion(), legacy: { signed: false, hasDocx: false } },
    });
    expect(text(h)).toContain('Sin incidencias.');
    // Los acuerdos salen del documento canónico del backend: el frontend no los calcula.
    expect(text(h)).toContain('1º Aprobación del presupuesto 2027: Se aprueba la propuesta sometida a votación.');
    // Las actuaciones van en una barra con su botón «Editar» al lado, como los comentarios de cada punto.
    expect(h.el.querySelectorAll('.agreements')[2].querySelector('.point__comment p')?.textContent).toBe('Pedir 3 presupuestos.\nRevisar la iluminación.');
    noteButtons(h)[0].click();
    expect(h.component.editing()).toEqual({ kind: 'general' });
    noteButtons(h)[1].click();
    expect(h.component.editing()).toEqual({ kind: 'next' });
    expect(h.component.dialog()?.target.comments).toBe('Pedir 3 presupuestos.\n\nRevisar la iluminación.');
  });

  it('puts Observaciones right below the agenda card, and drops the property search from Asistencia', () => {
    const h = setup();
    const titles = Array.from(h.el.querySelectorAll('app-meeting-card')).map((card) => card.getAttribute('title'));
    expect(titles.indexOf('Observaciones')).toBe(titles.indexOf('Orden del día y resultados') + 1);
    expect(h.el.querySelector('input[type="search"]')).toBeNull();
    expect(text(h)).not.toContain('Propiedades presentes o representadas');
  });

  it.each([
    ['the acta is signed', { status: 'firmada' as const, actaSignedAt: '2026-10-20T10:00:00Z' }],
    ['the meeting is cancelled', { status: 'cancelada' as const }],
  ])('cannot edit the acta texts once %s', (_name, over) => {
    const h = setup({ meeting: meeting(over) });
    expect(noteButtons(h).map((b) => b.disabled)).toEqual([true, true]);
  });

  describe('firmar desde «Firmas requeridas»', () => {
    const pills = (h: ReturnType<typeof setup>) =>
      Array.from(h.el.querySelectorAll('.signer')).map((li) => [li.querySelector('strong')!.textContent!.trim(), li.querySelector('app-status-pill, app-btn')!.textContent!.trim()]);

    it('sin turno de firma, cada cargo muestra su pastilla de estado y ningún botón Firmar', async () => {
      const h = await ready();
      expect(pills(h)).toEqual([['Presidente', 'Pendiente de firma'], ['Secretario / Administrador', 'Pendiente de firma']]);
    });

    it('si quien está conectado puede firmar como secretario/administrador, su pastilla pasa a ser el botón «Firmar»', async () => {
      const signing: ActaSigning = { readyForSignature: true, presidenteSigned: true, secretarioSigned: false, canSign: { presidente: false, secretario: true } };
      const h = await ready({ signing, signers: [{ role: 'Presidente', signed: true }, { role: 'Secretario / Administrador', signed: false }] });
      expect(pills(h)).toEqual([['Presidente', 'Firmado'], ['Secretario / Administrador', 'Firmar']]);
      expect(button(h, 'Firmar')).toBeTruthy();
    });

    it('al pulsar «Firmar» y confirmar, registra la firma propia y avisa', async () => {
      vi.spyOn(ConfirmDialogService.prototype, 'ask').mockResolvedValue(true);
      const signing: ActaSigning = { readyForSignature: true, presidenteSigned: true, secretarioSigned: false, canSign: { presidente: false, secretario: true } };
      const h = await ready({ signing, signers: [{ role: 'Presidente', signed: true }, { role: 'Secretario / Administrador', signed: false }] });
      const saved = vi.fn();
      h.component.saved.subscribe(saved);
      await h.component.sign(1);
      expect(h.api.signActaAsSelf).toHaveBeenCalledWith('m1', 'secretario');
      expect(saved).toHaveBeenCalledWith('Firma registrada.');
    });

    it('si se cancela la confirmación no firma', async () => {
      vi.spyOn(ConfirmDialogService.prototype, 'ask').mockResolvedValue(false);
      const signing: ActaSigning = { readyForSignature: true, presidenteSigned: false, secretarioSigned: false, canSign: { presidente: true, secretario: false } };
      const h = await ready({ signing });
      await h.component.sign(0);
      expect(h.api.signActaAsSelf).not.toHaveBeenCalled();
    });
  });

  describe('«Revisar» — acta canónica del backend', () => {
    const viewerEl = () => document.body.querySelector('app-acta-viewer') as HTMLElement | null;
    const dialogEl = () => document.body.querySelector('app-acta-prepare-dialog') as HTMLElement | null;
    const withVersion: ActaState = { version: actaVersion(), legacy: { signed: false, hasDocx: false } };

    it('con un borrador ya generado lo abre tal cual: no valida, no genera y no crea otra versión', async () => {
      const h = await ready({ acta: withVersion });
      await h.component.openReview();
      h.fixture.detectChanges();
      expect(viewerEl()).not.toBeNull();
      expect(viewerEl()!.textContent).toContain('ACTA DE LA JUNTA GENERAL ORDINARIA');
      expect(h.api.validateActa).not.toHaveBeenCalled();
      expect(h.api.generateActa).not.toHaveBeenCalled();
    });

    it('si las notas cambiaron después de generar el borrador, las recoge al abrirlo', async () => {
      const stale: ActaState = { version: actaVersion({ notesChanged: true }), legacy: { signed: false, hasDocx: false } };
      const h = await ready({ acta: stale });
      await h.component.openReview();
      h.fixture.detectChanges();
      expect(h.api.syncActaNotes).toHaveBeenCalledWith('m1');
      expect(h.api.generateActa).not.toHaveBeenCalled();
      expect(viewerEl()!.textContent).toContain('Versión 6');
    });

    it('un borrador anterior a incluir nombre y DNI de los asistentes se actualiza al abrirlo', async () => {
      const legacy = actaVersion();
      legacy.document.attendance.rows = legacy.document.attendance.rows.map(({ attendee: _name, attendeeDni: _dni, ...row }) => row);
      const h = await ready({ acta: { version: legacy, legacy: { signed: false, hasDocx: false } } });
      await h.component.openReview();
      expect(h.api.syncActaNotes).toHaveBeenCalledWith('m1');
    });

    it('si no se pueden recoger las notas nuevas, abre el acta igualmente', async () => {
      const stale: ActaState = { version: actaVersion({ notesChanged: true }), legacy: { signed: false, hasDocx: false } };
      const h = await ready({ acta: stale });
      h.api.syncActaNotes.mockRejectedValue(new Error('404'));
      const failed = vi.fn();
      h.component.failed.subscribe(failed);
      await h.component.openReview();
      h.fixture.detectChanges();
      expect(viewerEl()).not.toBeNull();
      expect(failed).not.toHaveBeenCalled();
    });

    it('sin notas nuevas no toca el borrador', async () => {
      const h = await ready({ acta: withVersion });
      await h.component.openReview();
      expect(h.api.syncActaNotes).not.toHaveBeenCalled();
    });

    it('los comentarios aún sin guardar se guardan antes de abrir el acta, para que salgan en ella', async () => {
      const h = await ready({ acta: withVersion });
      h.component.openNote('general');
      h.component.stage('Comentario general escrito justo antes de revisar.');
      await h.component.openReview();
      expect(h.api.saveActaVersion).toHaveBeenCalledWith('m1', expect.objectContaining({ generalComments: 'Comentario general escrito justo antes de revisar.' }));
      expect(h.api.saveActaVersion.mock.invocationCallOrder[0]).toBeLessThan(h.api.getActa.mock.invocationCallOrder.at(-1)!);
    });

    it('el botón ya no se limita a abrir un visor calculado en el navegador: consulta el acta del backend', async () => {
      const h = await ready({ acta: withVersion });
      button(h, 'Revisar').click();
      await settle();
      h.fixture.detectChanges();
      expect(h.api.getActa).toHaveBeenCalledWith('m1');
      expect(viewerEl()).not.toBeNull();
    });

    it('sin borrador y con todos los datos de la reunión, valida, genera el borrador y abre el visor con los avisos', async () => {
      const validation = actaValidation({ canGenerate: true, missingFields: [], warnings: [{ code: 'NO_LOCATION', message: 'La junta no tiene lugar indicado.' }] });
      const h = await ready({ validation });
      const saved = vi.fn();
      h.component.saved.subscribe(saved);
      await h.component.openReview();
      h.fixture.detectChanges();
      expect(h.api.validateActa).toHaveBeenCalledWith('m1');
      expect(h.api.generateActa).toHaveBeenCalledWith('m1', {});
      expect(viewerEl()).not.toBeNull();
      expect(viewerEl()!.textContent).toContain('La junta no tiene lugar indicado.');
      expect(dialogEl()).toBeNull();
      expect(saved).toHaveBeenCalledWith('Borrador del acta generado.');
    });

    it('si faltan horas o convocatoria no devuelve un error técnico: abre un paso pequeño para completarlos', async () => {
      const h = await ready();
      await h.component.openReview();
      h.fixture.detectChanges();
      expect(dialogEl()).not.toBeNull();
      expect(dialogEl()!.textContent).toContain('Preparar el acta');
      expect(viewerEl()).toBeNull();
      expect(h.api.generateActa).not.toHaveBeenCalled();
    });

    it('al completar los datos genera el borrador con ellos, cierra el paso y abre el visor', async () => {
      const h = await ready();
      await h.component.openReview();
      await h.component.confirmPrepare({ actualStartAt: '2026-10-14T17:10:00.000Z', actualEndAt: '2026-10-14T19:05:00.000Z', effectiveConvocation: 'primera' });
      h.fixture.detectChanges();
      expect(h.api.generateActa).toHaveBeenCalledWith('m1', { actualStartAt: '2026-10-14T17:10:00.000Z', actualEndAt: '2026-10-14T19:05:00.000Z', effectiveConvocation: 'primera' });
      expect(dialogEl()).toBeNull();
      expect(viewerEl()).not.toBeNull();
    });

    it('si el backend rechaza la generación, el paso sigue abierto con lo que falta y el motivo', async () => {
      const h = await ready();
      await h.component.openReview();
      h.api.generateActa.mockRejectedValueOnce({
        error: { message: 'Faltan datos para preparar el acta.', validation: actaValidation({ errors: [{ code: 'VOTES_OPEN', message: 'Hay 1 votación(es) abierta(s): ciérralas antes de preparar el acta.' }] }) },
      });
      await h.component.confirmPrepare({ actualStartAt: '2026-10-14T17:10:00.000Z', actualEndAt: '2026-10-14T19:05:00.000Z', effectiveConvocation: 'primera' });
      h.fixture.detectChanges();
      expect(dialogEl()).not.toBeNull();
      expect(dialogEl()!.textContent).toContain('Hay 1 votación(es) abierta(s)');
      expect(dialogEl()!.textContent).toContain('Faltan datos para preparar el acta.');
      expect(viewerEl()).toBeNull();
    });

    it('un acta firmada antes del nuevo formato no se reconstruye: se avisa y se ofrece el Word firmado', async () => {
      const ask = vi.spyOn(ConfirmDialogService.prototype, 'ask').mockResolvedValue(true);
      const h = await ready({
        meeting: meeting({ status: 'firmada', actaSignedAt: '2026-10-20T10:00:00Z' }),
        acta: { version: null, legacy: { signed: true, hasDocx: true } },
      });
      const download = vi.fn();
      h.component.download.subscribe(download);
      await h.component.openReview();
      expect(ask).toHaveBeenCalledWith(expect.objectContaining({ title: 'Acta anterior al nuevo formato', confirmLabel: 'Descargar acta (Word)' }));
      expect(download).toHaveBeenCalled();
      expect(h.api.validateActa).not.toHaveBeenCalled();
      expect(h.api.generateActa).not.toHaveBeenCalled();
      expect(viewerEl()).toBeNull();
      ask.mockRestore();
    });

    it.each(['convocada', 'cancelada'] as const)('con la junta %s no se puede revisar el acta', async (status) => {
      const h = await ready({ meeting: meeting({ status }) });
      expect(button(h, 'Revisar').disabled).toBe(true);
      h.api.getActa.mockClear();
      await h.component.openReview();
      expect(h.api.getActa).not.toHaveBeenCalled();
      expect(h.api.validateActa).not.toHaveBeenCalled();
    });

    it('«Volver» cierra el visor sin crear nada', async () => {
      const h = await ready({ acta: withVersion });
      await h.component.openReview();
      h.fixture.detectChanges();
      (viewerEl()!.querySelector('.toolbar app-btn button') as HTMLButtonElement).click();
      h.fixture.detectChanges();
      expect(viewerEl()).toBeNull();
    });

    it('guardar, regenerar y preparar para firma llaman al backend y refrescan la versión mostrada', async () => {
      const h = await ready({ acta: withVersion });
      const saved = vi.fn();
      h.component.saved.subscribe(saved);
      await h.component.openReview();

      await h.component.saveViewerEdits({ baseVersionId: 'v3', items: [{ id: 'a1', narrative: 'Texto.' }] });
      expect(h.api.saveActaEdits).toHaveBeenCalledWith('m1', { baseVersionId: 'v3', items: [{ id: 'a1', narrative: 'Texto.' }] });
      expect(h.component.viewer()?.versionNumber).toBe(4);

      await h.component.regenerateNarrative();
      expect(h.api.regenerateActaNarrative).toHaveBeenCalledWith('m1');
      expect(h.component.viewer()?.versionNumber).toBe(5);

      await h.component.prepareForSignature();
      expect(h.api.prepareActaForSignature).toHaveBeenCalledWith('m1');
      expect(h.component.viewer()?.status).toBe('readyForSignature');
      expect(saved).toHaveBeenCalledWith('Acta preparada para la firma.');
    });

    it('un error al guardar se muestra en el visor y no lo cierra', async () => {
      const h = await ready({ acta: withVersion });
      await h.component.openReview();
      h.api.saveActaEdits.mockRejectedValueOnce({ error: { message: 'Hay una versión más reciente del acta: recárgala antes de guardar tus cambios.' } });
      await h.component.saveViewerEdits({ baseVersionId: 'v3', introduction: 'x' });
      h.fixture.detectChanges();
      expect(viewerEl()!.textContent).toContain('Hay una versión más reciente del acta');
      expect(h.component.viewer()).not.toBeNull();
    });

    it('lista las versiones del acta al abrir el visor y deja ver una anterior en solo lectura', async () => {
      const h = await ready({ acta: withVersion });
      await h.component.openReview();
      await settle();
      h.fixture.detectChanges();
      expect(h.api.listActaDocumentVersions).toHaveBeenCalledWith('m1');
      expect(h.component.actaVersions().map((entry) => entry.versionNumber)).toEqual([3, 2]);
      await h.component.pickActaVersion('v2');
      h.fixture.detectChanges();
      expect(h.api.getActaDocumentVersion).toHaveBeenCalledWith('m1', 'v2');
      expect(h.component.viewer()).toMatchObject({ id: 'v2', status: 'superseded', editable: false });
      expect(viewerEl()!.textContent).toContain('ya fue sustituida');
    });

    it('si no se puede cargar la versión elegida, lo dice en el visor y mantiene la que había', async () => {
      const h = await ready({ acta: withVersion });
      await h.component.openReview();
      h.api.getActaDocumentVersion.mockRejectedValueOnce({ error: { message: 'La versión no existe.' } });
      await h.component.pickActaVersion('v2');
      h.fixture.detectChanges();
      expect(h.component.viewer()?.id).toBe('v3');
      expect(viewerEl()!.textContent).toContain('La versión no existe.');
    });

    it('«Continuar a la firma» cierra el visor y sigue a la pantalla de firma; «Descargar PDF» lo emite', async () => {
      const h = await ready({ acta: { version: actaVersion({ status: 'readyForSignature', statusLabel: 'Lista para firma' }), legacy: { signed: false, hasDocx: false } } });
      const review = vi.fn();
      const pdf = vi.fn();
      h.component.review.subscribe(review);
      h.component.downloadPdf.subscribe(pdf);
      await h.component.openReview();
      h.fixture.detectChanges();
      const find = (label: string) => Array.from(viewerEl()!.querySelectorAll('button')).find((b) => b.textContent?.includes(label)) as HTMLButtonElement;
      find('Descargar PDF').click();
      expect(pdf).toHaveBeenCalled();
      find('Continuar a la firma').click();
      h.fixture.detectChanges();
      expect(review).toHaveBeenCalled();
      expect(viewerEl()).toBeNull();
    });

    it('corregir horas y convocatoria vuelve a congelar los datos de la junta (refresh)', async () => {
      const h = await ready({ acta: withVersion, validation: actaValidation({ canGenerate: true, missingFields: [], confirmed: { actualStartAt: '2026-10-14T17:10:00.000Z', actualEndAt: '2026-10-14T19:05:00.000Z', effectiveConvocation: 'primera' } }) });
      await h.component.openReview();
      await h.component.editMeetingData();
      h.fixture.detectChanges();
      expect(dialogEl()).not.toBeNull();
      await h.component.confirmPrepare({ effectiveConvocation: 'segunda' });
      expect(h.api.generateActa).toHaveBeenCalledWith('m1', { effectiveConvocation: 'segunda', refresh: true });
    });
  });

  it('download and send live in the ⋯ menu', () => {
    const h = setup();
    (h.el.querySelector('.menu__trigger') as HTMLButtonElement).click();
    h.fixture.detectChanges();
    const items = Array.from(h.el.querySelectorAll('.menu__panel button')) as HTMLButtonElement[];
    expect(items.map((item) => [item.textContent?.trim(), item.disabled])).toEqual([
      ['Descargar acta', true],
      ['Enviar a propietarios', true],
    ]);
  });

  describe('versions and manual saving', () => {
    const latest = version(2, { generalComments: 'Antes', nextSteps: 'Paso 1', savedByName: 'Luis' });
    const older = version(1, { generalComments: 'Primera', nextSteps: null, pointComments: [{ id: 'a1', title: 'Aprobación del acta anterior', comments: 'Nota antigua' }] });
    const withVersions = { versions: [latest, older], meeting: meeting({ actaGeneralComments: 'Antes', actaNextSteps: 'Paso 1' }) };

    it('lists the saved history in the dropdown, newest first, after the current draft', async () => {
      const h = await ready(withVersions);
      expect(h.api.listActaVersions).toHaveBeenCalledWith('m1');
      expect(h.component.versionOptions.map((option) => option.label.replace(/ · \d+ \w+, \d+:\d+/, ''))).toEqual([
        'Borrador actual',
        'Versión 2 · Luis',
        'Versión 1 · Ana Gestora',
      ]);
      expect(h.el.querySelectorAll('.version select option').length).toBe(3);
    });

    it('nothing is saved automatically: editing only stages the text and enables Guardar', async () => {
      const h = await ready(withVersions);
      expect(button(h, 'Guardar').disabled).toBe(true);
      expect(text(h)).toContain('Guardado');
      h.component.openNote('general');
      h.component.stage('Texto nuevo');
      h.fixture.detectChanges();
      expect(h.api.saveActaVersion).not.toHaveBeenCalled();
      expect(text(h)).toContain('Cambios sin guardar');
      expect(text(h)).toContain('Texto nuevo');
      expect(button(h, 'Guardar').disabled).toBe(false);
      expect(h.component.versionOptions[0].label).toBe('Borrador actual · sin guardar');
    });

    it('Guardar sends the whole draft, reloads the history and tells the workspace', async () => {
      const h = await ready(withVersions);
      const saved = vi.fn();
      h.component.saved.subscribe(saved);
      h.component.openPoint(point());
      h.component.stage('Intervino 2B');
      h.api.saveActaVersion.mockResolvedValueOnce(version(3));
      h.api.listActaVersions.mockResolvedValueOnce([version(3), latest, older]);
      h.fixture.detectChanges();
      button(h, 'Guardar').click();
      await settle();
      h.fixture.detectChanges();
      expect(h.api.saveActaVersion).toHaveBeenCalledWith('m1', {
        generalComments: 'Antes',
        nextSteps: 'Paso 1',
        pointComments: [{ itemId: 'a1', comments: 'Intervino 2B' }],
      });
      expect(saved).toHaveBeenCalledWith('Versión 3 del acta guardada.');
      expect(h.component.versions().length).toBe(3);
    });

    it('reports the API error and keeps the draft when saving fails', async () => {
      const h = await ready(withVersions);
      const failed = vi.fn();
      h.component.failed.subscribe(failed);
      h.component.openNote('next');
      h.component.stage('Otro paso');
      h.api.saveActaVersion.mockRejectedValueOnce({ error: { message: 'El acta ya está firmada: no se pueden guardar más versiones.' } });
      await h.component.save();
      expect(failed).toHaveBeenCalledWith('El acta ya está firmada: no se pueden guardar más versiones.');
      expect(h.component.dirty()).toBe(true);
    });

    it('shows an older version read-only, with its texts, and can restore it into the draft', async () => {
      const h = await ready({ ...withVersions, agenda: [point({ comments: 'Nota actual' })] });
      h.component.selectVersion('v1');
      h.fixture.detectChanges();
      expect(text(h)).toContain('Estás viendo la versión 1');
      expect(text(h)).toContain('Primera');
      expect(text(h)).toContain('Nota antigua');
      expect(text(h)).not.toContain('Nota actual');
      expect(noteButtons(h).every((b) => b.disabled)).toBe(true);
      expect(button(h, 'Guardar')).toBeUndefined();

      button(h, 'Restaurar esta versión').click();
      h.fixture.detectChanges();
      expect(h.component.selectedId()).toBeNull();
      expect(text(h)).toContain('Primera');
      expect(text(h)).toContain('Cambios sin guardar');
      expect(h.api.saveActaVersion).not.toHaveBeenCalled();
    });

    it('cannot save or restore once the acta is signed, but the history can still be read', async () => {
      const h = await ready({ ...withVersions, meeting: meeting({ status: 'firmada', actaSignedAt: '2026-10-20T10:00:00Z' }) });
      expect(button(h, 'Guardar').disabled).toBe(true);
      h.component.selectVersion('v1');
      h.fixture.detectChanges();
      expect(button(h, 'Restaurar esta versión').disabled).toBe(true);
    });

    it('uses the dropdown of the rest of the app instead of the native one', async () => {
      const h = await ready(withVersions);
      expect(h.el.querySelector('.version select')?.classList.contains('dd-select')).toBe(true);
    });

    it('says so when the history cannot be loaded and does not offer to save blindly', async () => {
      const h = setup();
      await settle();
      const failed = vi.fn();
      h.component.failed.subscribe(failed);
      h.api.listActaVersions.mockRejectedValueOnce(new Error('x'));
      h.fixture.componentRef.setInput('meeting', meeting({ id: 'm2' }));
      h.fixture.detectChanges();
      await settle();
      expect(failed).toHaveBeenCalledWith('No se pudo cargar el histórico de versiones del acta.');
      expect(h.component.versionsLoaded()).toBe(false);
    });
  });
});
