import { API, setupComponent, settle, type ComponentHarness } from '../../../core/testing/component-harness';
import { PersonalTabComponent } from './personal-tab.component';
import type { StaffMember, StaffDocument } from '../../../core/models';

function makeStaff(overrides: Partial<StaffMember> = {}): StaffMember {
  return {
    id: 's1', estateId: 'e1', administratorId: 'a1', fullName: 'Juan Portero', position: 'Portero',
    contractType: 'Indefinido', startDate: '2024-01-01', status: 'Activo', createdAt: '2024-01-01',
    ...overrides,
  };
}

function makeDoc(overrides: Partial<StaffDocument> = {}): StaffDocument {
  return { id: 'd1', staffMemberId: 's1', title: 'DNI', fileName: 'dni.pdf', mimeType: 'application/pdf', createdAt: '2024-01-01', ...overrides };
}

describe('PersonalTabComponent', () => {
  let h: ComponentHarness<PersonalTabComponent>;

  beforeEach(() => {
    h = setupComponent(PersonalTabComponent);
    h.component.estateId = 'e1';
  });

  afterEach(() => h.http.verify());

  function flushInitialLoad(staff: StaffMember[]): void {
    h.fixture.detectChanges();
    h.http.expectOne((r) => r.url === `${API}/estates/e1/staff`).flush(staff);
  }

  it('carga el personal al montar y refleja los KPIs (activos y puestos distintos)', async () => {
    flushInitialLoad([
      makeStaff({ id: 's1', position: 'Portero', status: 'Activo' }),
      makeStaff({ id: 's2', position: 'Seguridad', status: 'Activo' }),
      makeStaff({ id: 's3', position: 'Portero', status: 'Baja' }),
    ]);
    await settle();
    h.fixture.detectChanges();

    const kpis = h.el.querySelectorAll('.kpi-card__value');
    expect(kpis[0].textContent?.trim()).toBe('2'); // personal activo
    expect(kpis[1].textContent?.trim()).toBe('3'); // total registrado (incluye bajas)
    expect(h.el.querySelectorAll('tbody tr')).toHaveLength(3);
  });

  it('sin personal, muestra el estado vacío', async () => {
    flushInitialLoad([]);
    await settle();
    h.fixture.detectChanges();

    expect(h.el.textContent).toContain('Todavía no hay personal registrado en esta finca');
  });

  describe('detalle de un miembro del personal', () => {
    it('carga sus documentos y muestra los datos del contrato y contacto', async () => {
      flushInitialLoad([makeStaff({ id: 's1', fullName: 'Juan Portero', nationalId: '12345678A', schedule: 'L-V 8-16', monthlyCost: 1200 })]);
      await settle();
      h.fixture.detectChanges();

      (h.el.querySelector('tbody tr') as HTMLElement).click();
      h.http.expectOne((r) => r.url === `${API}/estates/e1/staff/s1/documents`).flush([makeDoc()]);
      await settle();
      h.fixture.detectChanges();

      expect(h.el.querySelector('.drawer')).not.toBeNull();
      expect(h.el.textContent).toContain('12345678A');
      expect(h.el.textContent).toContain('L-V 8-16');
      // Ver nota sobre Number.toLocaleString('es-ES') sin separador de miles
      // en este runtime, en proveedores-tab.component.spec.ts.
      expect(h.el.textContent).toContain('1200,00');
      expect(h.el.querySelectorAll('.invoice-row')).toHaveLength(1);
    });
  });

  describe('modal "Nuevo miembro del personal"', () => {
    it('sin nombre ni puesto, no envía nada y marca los errores', async () => {
      flushInitialLoad([]);
      await settle();
      h.fixture.detectChanges();

      (Array.from(h.el.querySelectorAll('button')).find((b) => b.textContent?.includes('Nuevo miembro del personal')) as HTMLElement).click();
      h.fixture.detectChanges();
      (Array.from(h.el.querySelectorAll('.modal__footer button')).find((b) => b.textContent?.includes('Añadir')) as HTMLElement).click();
      h.fixture.detectChanges();

      expect(h.component.npErrors()).toEqual({ fullName: true, position: true });
      h.http.expectNone((r) => r.method === 'POST');
    });

    it('con los campos completos, crea el registro y lo antepone a la lista', async () => {
      flushInitialLoad([makeStaff({ id: 's-vieja', fullName: 'Vieja' })]);
      await settle();
      h.fixture.detectChanges();

      h.component.openNuevoPersonal();
      h.component.npFullName.set('Ana Nueva');
      h.component.npPosition.set('Socorrista');
      h.fixture.detectChanges();

      const submitPromise = h.component.submitNuevoPersonal();
      const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/staff` && r.method === 'POST');
      expect(req.request.body).toMatchObject({ fullName: 'Ana Nueva', position: 'Socorrista', contractType: 'Indefinido' });
      req.flush(makeStaff({ id: 's-nueva', fullName: 'Ana Nueva', position: 'Socorrista' }));
      await submitPromise;
      h.fixture.detectChanges();

      expect(h.component.showNuevoPersonal()).toBe(false);
      const names = Array.from(h.el.querySelectorAll('.supplier-name span')).map((n) => n.textContent);
      expect(names).toEqual(['Ana Nueva', 'Vieja']);
      expect(h.el.querySelector('.toast')?.textContent).toContain('añadido correctamente');
    });
  });

  describe('dar de baja', () => {
    it('con confirmación, manda status=Baja y endDate de hoy, y refleja el cambio en la fila', async () => {
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
      flushInitialLoad([makeStaff({ id: 's1', fullName: 'Juan', status: 'Activo' })]);
      await settle();
      h.fixture.detectChanges();
      (h.el.querySelector('tbody tr') as HTMLElement).click();
      h.http.expectOne((r) => r.url === `${API}/estates/e1/staff/s1/documents`).flush([]);
      await settle();
      h.fixture.detectChanges();

      (Array.from(h.el.querySelectorAll('button')).find((b) => b.textContent?.includes('Dar de baja')) as HTMLElement).click();

      expect(confirmSpy).toHaveBeenCalled();
      const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/staff/s1` && r.method === 'PATCH');
      expect(req.request.body.status).toBe('Baja');
      expect(typeof req.request.body.endDate).toBe('string');
      req.flush(makeStaff({ id: 's1', fullName: 'Juan', status: 'Baja' }));
      await settle();
      h.fixture.detectChanges();

      expect(h.el.querySelector('.toast')?.textContent).toContain('dado de baja');
    });

    it('sin confirmación, no manda ninguna petición', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(false);
      flushInitialLoad([makeStaff({ id: 's1', status: 'Activo' })]);
      await settle();
      h.fixture.detectChanges();
      (h.el.querySelector('tbody tr') as HTMLElement).click();
      h.http.expectOne((r) => r.url === `${API}/estates/e1/staff/s1/documents`).flush([]);
      await settle();
      h.fixture.detectChanges();

      (Array.from(h.el.querySelectorAll('button')).find((b) => b.textContent?.includes('Dar de baja')) as HTMLElement).click();

      h.http.expectNone((r) => r.method === 'PATCH');
    });
  });

  describe('documentos adjuntos', () => {
    async function openDetailWithDocs(docs: StaffDocument[]) {
      flushInitialLoad([makeStaff({ id: 's1' })]);
      await settle();
      h.fixture.detectChanges();
      (h.el.querySelector('tbody tr') as HTMLElement).click();
      h.http.expectOne((r) => r.url === `${API}/estates/e1/staff/s1/documents`).flush(docs);
      await settle();
      h.fixture.detectChanges();
    }

    it('subir un documento lo antepone a la lista', async () => {
      await openDetailWithDocs([]);
      h.component.docTitleInput.set('Contrato');
      h.component.onDocFileSelected({ target: { files: [new File(['x'], 'contrato.pdf')] } } as unknown as Event);

      const submitPromise = h.component.submitDocument();
      const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/staff/s1/documents` && r.method === 'POST');
      expect(req.request.body instanceof FormData).toBe(true);
      expect((req.request.body as FormData).get('title')).toBe('Contrato');
      req.flush(makeDoc({ id: 'd-nuevo', title: 'Contrato' }));
      await submitPromise;
      h.fixture.detectChanges();

      expect(h.el.querySelectorAll('.invoice-row')).toHaveLength(1);
      expect(h.el.textContent).toContain('Contrato');
    });

    it('descargar un documento pide el fichero y limpia el object URL', async () => {
      const originalCreate = URL.createObjectURL;
      const originalRevoke = URL.revokeObjectURL;
      URL.createObjectURL = vi.fn(() => 'blob:fake-url');
      URL.revokeObjectURL = vi.fn();
      try {
        await openDetailWithDocs([makeDoc({ id: 'd1', fileName: 'dni.pdf' })]);

        const promise = h.component.downloadDocument(h.component.staffDocuments()[0]);
        const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/staff/s1/documents/d1/file`);
        req.flush(new Blob(['contenido']));
        await promise;

        expect(URL.createObjectURL).toHaveBeenCalled();
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
      } finally {
        URL.createObjectURL = originalCreate;
        URL.revokeObjectURL = originalRevoke;
      }
    });

    it('eliminar un documento, con confirmación, lo quita de la lista', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      await openDetailWithDocs([makeDoc({ id: 'd1' })]);

      (Array.from(h.el.querySelectorAll('.icon-btn')).find((b) => b.getAttribute('title') === 'Eliminar') as HTMLElement).click();

      h.http.expectOne((r) => r.url === `${API}/estates/e1/staff/s1/documents/d1` && r.method === 'DELETE').flush(null);
      await settle();
      h.fixture.detectChanges();

      expect(h.el.querySelectorAll('.invoice-row')).toHaveLength(0);
    });
  });
});
