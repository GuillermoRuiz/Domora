import { API, makeUser, setupComponent, settle } from '../../../core/testing/component-harness';
import { IssueEditDialogComponent, type IssueEditKind } from './issue-edit-dialog.component';
import type { Issue, IssueProviderAssignment } from '../../../core/models';

const issue: Issue = {
  id: 'i1', ref: 'INC-1', type: 'Avería', title: 'Humedad', description: 'x', status: 'Abierta', priority: 'Normal',
  source: 'Propietario', date: '2026-10-13', photos: [], timeline: [], estateId: 'e1', assetId: 'a1',
  budgetAmount: 300, budgetDescription: 'Pintura', budgetApproved: false,
};
const provider = {
  id: 'p1', issueId: 'i1', supplierId: null, providerNameSnapshot: 'Fontanería Sol', categorySnapshot: 'Fontanería',
  phoneSnapshot: '600111222', estimatedResolutionDate: '2026-11-02T00:00:00.000Z', assignedAt: '2026-10-14', assignedByUserId: null,
} as IssueProviderAssignment;

describe('IssueEditDialogComponent', () => {
  async function setup(kind: IssueEditKind, current: IssueProviderAssignment | null = provider) {
    const h = setupComponent(IssueEditDialogComponent, { user: makeUser() });
    h.fixture.componentRef.setInput('kind', kind);
    h.fixture.componentRef.setInput('issue', issue);
    h.fixture.componentRef.setInput('provider', current);
    h.fixture.detectChanges();
    const saved: string[] = [];
    const closed: number[] = [];
    h.component.saved.subscribe((m) => saved.push(m));
    h.component.closed.subscribe(() => closed.push(1));
    return { h, saved, closed };
  }

  describe('proveedor', () => {
    it('starts from the current assignment and offers the active suppliers of the community', async () => {
      const { h } = await setup('provider');
      h.http.expectOne(`${API}/estates/e1/suppliers`).flush([
        { id: 's1', name: 'Ascensores Levante', category: 'Ascensores', status: 'Activo' },
        { id: 's2', name: 'Antiguos S.L.', category: 'Otros', status: 'Inactivo' },
      ]);
      await settle();
      expect(h.component.providerName()).toBe('Fontanería Sol');
      expect(h.component.providerResolution()).toBe('2026-11-02');
      expect(h.component.directory().map((s) => s.name)).toEqual(['Ascensores Levante']);
      h.http.verify();
    });

    it('a supplier of the directory fixes its name and category', async () => {
      const { h } = await setup('provider', null);
      h.http.expectOne(`${API}/estates/e1/suppliers`).flush([{ id: 's1', name: 'Ascensores Levante', category: 'Ascensores', status: 'Activo' }]);
      await settle();
      h.component.chooseSupplier('s1');
      expect(h.component.providerName()).toBe('Ascensores Levante');
      expect(h.component.providerCategory()).toBe('Ascensores');
      h.http.verify();
    });

    it('assigns the provider and reports it', async () => {
      const { h, saved } = await setup('provider');
      h.http.expectOne(`${API}/estates/e1/suppliers`).flush([]);
      await settle();
      h.component.providerName.set('Reparaciones del Norte');
      const done = h.component.save();
      const post = h.http.expectOne((r) => r.method === 'POST' && r.url === `${API}/issues/i1/provider`);
      expect(post.request.body).toMatchObject({ providerNameSnapshot: 'Reparaciones del Norte', phoneSnapshot: '600111222' });
      post.flush({});
      await done;
      expect(saved).toEqual(['Proveedor actualizado']);
      h.http.verify();
    });

    it('keeps the dialog open with the reason when the assignment is refused', async () => {
      const { h, saved } = await setup('provider');
      h.http.expectOne(`${API}/estates/e1/suppliers`).flush([]);
      await settle();
      const done = h.component.save();
      h.http.expectOne((r) => r.method === 'POST').flush({ message: 'La incidencia está cerrada' }, { status: 409, statusText: 'Conflict' });
      await done;
      expect(h.component.error()).toBe('La incidencia está cerrada');
      expect(saved).toEqual([]);
    });
  });

  describe('presupuesto', () => {
    it('shows the current budget and saves the new one', async () => {
      const { h, saved } = await setup('budget');
      expect(h.component.amount()).toBe(300);
      expect(h.component.budgetDescription()).toBe('Pintura');
      h.component.amount.set(450);
      h.component.approved.set(true);
      const done = h.component.save();
      const patch = h.http.expectOne((r) => r.method === 'PATCH' && r.url === `${API}/issues/i1/budget`);
      expect(patch.request.body).toEqual({ budgetAmount: 450, budgetDescription: 'Pintura', budgetApproved: true });
      patch.flush({});
      await done;
      expect(saved).toEqual(['Presupuesto actualizado']);
      h.http.verify();
    });
  });

  describe('instalación', () => {
    it('links another installation, or none for a common zone', async () => {
      const { h, saved } = await setup('installation');
      h.http.expectOne(`${API}/estates/e1/assets`).flush([{ id: 'a1', name: 'Ascensor' }, { id: 'a2', name: 'Cubierta' }]);
      await settle();
      expect(h.component.assetId()).toBe('a1');
      h.component.assetId.set('');
      const done = h.component.save();
      const patch = h.http.expectOne((r) => r.method === 'PATCH' && r.url === `${API}/issues/i1/asset`);
      expect(patch.request.body).toEqual({ assetId: null });
      patch.flush({});
      await done;
      expect(saved).toEqual(['Instalación actualizada']);
      h.http.verify();
    });

    it('does not call the server when nothing changed', async () => {
      const { h, saved } = await setup('installation');
      h.http.expectOne(`${API}/estates/e1/assets`).flush([]);
      await settle();
      await h.component.save();
      h.http.expectNone((r) => r.method === 'PATCH');
      expect(saved).toEqual(['Instalación actualizada']);
    });
  });
});
