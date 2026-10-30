import { Component, DestroyRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../core/auth.service';
import { InspectionsService } from '../../../core/inspections.service';
import { IssueWorkflowService } from '../../../core/issue-workflow.service';
import { ResolutionRoute } from '../../../core/issue-workflow.models';
import { IssuesService } from '../../../core/issues.service';
import { MeetingsService } from '../../../core/meetings.service';
import { SuppliersStaffService } from '../../../core/suppliers-staff.service';
import { Issue, IssueType } from '../../../core/models';
import { BtnComponent } from '../../../shared/components/btn/btn.component';
import { SelectDropdownDirective } from '../../../shared/components/dropdown/select-dropdown.directive';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { ISSUE_TITLE_MAX } from '../../incidencias-c/issue-helpers';
import { IssuePhotoPickerComponent } from '../issue-photo-picker/issue-photo-picker.component';
import { RouteGuideComponent } from '../route-guide/route-guide.component';

const ISSUE_TYPES: IssueType[] = ['Avería', 'Ruido', 'Daño estructural', 'Fuga', 'Seguridad', 'Limpieza', 'Otro'];

/** Por dónde llegó el aviso que se registra (los valores son los del catálogo del servidor). */
const CHANNELS: { value: 'form' | 'call' | 'email'; label: string }[] = [
  { value: 'call', label: 'Llamada' },
  { value: 'email', label: 'Correo electrónico' },
  { value: 'form', label: 'Formulario' },
];

/** Icono de cada tipo de incidencia y de cada canal: el del campo cambia con lo elegido. */
const TYPE_ICONS: Record<IssueType, string> = {
  'Avería': 'wrench',
  'Ruido': 'bell',
  'Daño estructural': 'roof',
  'Fuga': 'droplet',
  'Seguridad': 'shield',
  'Limpieza': 'sparkles',
  'Otro': 'help-circle',
};
const CHANNEL_ICONS = { call: 'phone', email: 'mail', form: 'file-text' } as const;

/** Alguien que puede haber avisado de la incidencia: la propia gestión, un propietario o un empleado de la comunidad. */
export interface Reporter {
  key: string;
  /** Su cuenta de Domora, si la tiene (propietarios): la incidencia queda a su nombre y recibe los avisos. */
  userId?: string;
  name: string;
  /** Teléfono o, si no hay, correo; vacío si no se conoce. */
  contact: string;
  group: 'admin' | 'owner' | 'staff';
  /** Cómo se muestra en el desplegable: «Ana Ruiz · Portera». */
  label: string;
}

/** Una comunidad en la que se puede registrar la incidencia. */
export interface IssueEstateOption {
  id: string;
  name: string;
  address: string;
}

/**
 * «Nueva incidencia» de la gestión: siempre de una comunidad (la que traiga elegida quien abre el diálogo o la que se
 * elija aquí), con la instalación afectada, cómo llegó el aviso y quién avisó (un desplegable con la propia gestión, los
 * propietarios y los empleados de la comunidad); la zona y las fotos son opcionales. Al crearla devuelve la incidencia
 * para que la pantalla abra su expediente.
 */
@Component({
  selector: 'app-new-issue-dialog',
  standalone: true,
  imports: [FormsModule, BtnComponent, IconComponent, IssuePhotoPickerComponent, RouteGuideComponent, SelectDropdownDirective],
  templateUrl: './new-issue-dialog.component.html',
  styleUrl: './new-issue-dialog.component.scss',
})
export class NewIssueDialogComponent {
  private readonly issuesApi = inject(IssuesService);
  private readonly workflowApi = inject(IssueWorkflowService);
  private readonly inspectionsApi = inject(InspectionsService);
  private readonly meetingsApi = inject(MeetingsService);
  private readonly staffApi = inject(SuppliersStaffService);
  private readonly auth = inject(AuthService);

  /** Las comunidades entre las que elegir. */
  readonly estates = input<IssueEstateOption[]>([]);
  /** La comunidad con la que se abre; null la deja por elegir. */
  readonly estateId = input<string | null>(null);
  readonly created = output<Issue>();
  readonly closed = output<void>();

  readonly types = ISSUE_TYPES;
  readonly maxTitle = ISSUE_TITLE_MAX;
  readonly channels = CHANNELS;
  readonly chosenEstate = signal('');
  readonly installations = signal<{ id: string; name: string }[]>([]);
  /** Ya se sabe qué instalaciones tiene la comunidad (sin saberlo no se puede exigir elegir una). */
  readonly installationsLoaded = signal(false);
  readonly type = signal<IssueType>('Avería');
  readonly priority = signal<'Normal' | 'Urgente'>('Normal');
  readonly title = signal('');
  readonly description = signal('');
  readonly assetId = signal('');
  readonly location = signal('');
  readonly channel = signal<'form' | 'call' | 'email'>('call');
  /** Quién avisó: la clave de `reporters` elegida y su contacto (se rellena al elegir, y se puede corregir). */
  readonly reporterKey = signal('');
  readonly reporterContact = signal('');
  readonly reporters = signal<Reporter[]>([]);
  readonly files = signal<File[]>([]);
  /** La vía de gestión es obligatoria: ninguna incidencia nace «por determinar». */
  readonly route = signal<ResolutionRoute | null>(null);
  readonly routeReason = signal('');
  readonly errors = signal<{ estate?: boolean; title?: boolean; asset?: boolean; description?: boolean; reporter?: boolean; contact?: boolean; route?: boolean }>({});
  /** Parte del formulario que se ve: la incidencia o su información adicional. */
  readonly step = signal<'main' | 'extra'>('main');
  readonly saving = signal(false);
  readonly failure = signal('');

  readonly typeIcon = computed(() => TYPE_ICONS[this.type()] ?? 'wrench');
  readonly priorityIcon = computed(() => (this.priority() === 'Urgente' ? 'exclamation' : 'tag'));
  readonly channelIcon = computed(() => CHANNEL_ICONS[this.channel()]);
  readonly targetEstateId = computed(() => this.chosenEstate() || this.estateId() || '');
  /** Elegir instalación es obligatorio salvo que la comunidad no tenga ninguna dada de alta. */
  readonly assetRequired = computed(() => this.installationsLoaded() && this.installations().length > 0);
  readonly reporterGroups = computed(() => [
    { title: 'Administración', items: this.reporters().filter((r) => r.group === 'admin') },
    { title: 'Propietarios', items: this.reporters().filter((r) => r.group === 'owner') },
    { title: 'Empleados de la comunidad', items: this.reporters().filter((r) => r.group === 'staff') },
  ].filter((g) => g.items.length > 0));
  private assetsSeq = 0;
  private reportersSeq = 0;

  constructor() {
    effect(() => {
      const estateId = this.targetEstateId();
      untracked(() => {
        void this.loadInstallations(estateId);
        void this.loadReporters(estateId);
      });
    });
    inject(DestroyRef).onDestroy(() => {
      this.assetsSeq++;
      this.reportersSeq++;
    });
  }

  chooseEstate(id: string): void {
    this.chosenEstate.set(id);
    this.assetId.set('');
    this.reporterKey.set('');
    this.reporterContact.set('');
    this.errors.update((e) => ({ ...e, estate: false }));
  }

  /** Al elegir quién avisó se propone su teléfono o correo como contacto. */
  chooseReporter(key: string): void {
    this.reporterKey.set(key);
    this.reporterContact.set(this.reporters().find((r) => r.key === key)?.contact ?? '');
    this.errors.update((e) => ({ ...e, reporter: false, contact: false }));
  }

  async submit(): Promise<void> {
    if (this.saving()) return;
    const estateId = this.targetEstateId();
    const title = this.title().trim();
    const description = this.description().trim();
    const reporter = this.reporters().find((r) => r.key === this.reporterKey());
    const contact = this.reporterContact().trim();
    const errors = {
      ...(estateId ? {} : { estate: true }),
      ...(title ? {} : { title: true }),
      ...(this.assetRequired() && !this.assetId() ? { asset: true } : {}),
      ...(description ? {} : { description: true }),
      ...(reporter ? {} : { reporter: true }),
      ...(contact ? {} : { contact: true }),
      ...(this.route() ? {} : { route: true }),
    };
    this.errors.set(errors);
    if (Object.keys(errors).length) {
      // Se lleva a la parte donde está el primer fallo.
      const inExtra = (k: string) => k === 'reporter' || k === 'contact' || k === 'route';
      this.step.set(Object.keys(errors).every(inExtra) ? 'extra' : 'main');
      return;
    }
    this.saving.set(true);
    this.failure.set('');
    try {
      const issue = await this.issuesApi.createIssue(estateId, {
        type: this.type(),
        title,
        description,
        priority: this.priority(),
        assetId: this.assetId() || undefined,
        location: this.location().trim() || undefined,
        channel: this.channel(),
        reporterUserId: reporter?.userId,
        reporterName: reporter?.name,
        reporterContact: contact,
        // La vía viaja con el alta: la incidencia nace con ella y no se abre «Revisar incidencia nueva».
        resolutionRoute: this.route() ?? undefined,
        routeReason: this.routeReason() || undefined,
      });
      for (const file of this.files()) {
        try {
          await this.issuesApi.uploadIssuePhoto(issue.id, file);
        } catch {
          // La incidencia ya existe: lo que no se suba se puede añadir desde su ficha.
        }
      }
      this.created.emit(issue);
    } catch (error) {
      const message = (error as { error?: { message?: string | string[] } })?.error?.message;
      this.failure.set((Array.isArray(message) ? message.join(' ') : message) || 'No se pudo crear la incidencia. Inténtalo de nuevo.');
    } finally {
      this.saving.set(false);
    }
  }

  private async loadInstallations(estateId: string): Promise<void> {
    const seq = ++this.assetsSeq;
    this.installations.set([]);
    this.installationsLoaded.set(false);
    if (!estateId) return;
    try {
      const assets = await this.inspectionsApi.listAssetsByEstate(estateId);
      if (seq !== this.assetsSeq) return;
      this.installations.set(assets.map((a) => ({ id: a.id, name: a.name })).sort((a, b) => a.name.localeCompare(b.name, 'es')));
      this.installationsLoaded.set(true);
    } catch {
      // Sin la lista no se puede exigir elegir una: se puede crear igualmente.
    }
  }

  /** Quién puede haber avisado: la propia gestión, los propietarios y los empleados de la comunidad. */
  private async loadReporters(estateId: string): Promise<void> {
    const seq = ++this.reportersSeq;
    const me = this.auth.currentUser();
    const self: Reporter[] = me ? [{ key: 'admin', name: me.fullName, contact: '', group: 'admin', label: `${me.fullName} (tú)` }] : [];
    this.reporters.set(self);
    if (!estateId) return;
    const [owners, staff] = await Promise.all([
      this.meetingsApi.listEstateOwnerEmails(estateId).catch(() => []),
      this.staffApi.listStaffByEstate(estateId).catch(() => []),
    ]);
    if (seq !== this.reportersSeq) return;
    const byName = (a: Reporter, b: Reporter) => a.name.localeCompare(b.name, 'es');
    this.reporters.set([
      ...self,
      ...owners
        .filter((o) => o.isOwner !== false)
        .map((o): Reporter => ({ key: `owner:${o.email}`, name: o.fullName, contact: o.email, group: 'owner', label: o.fullName, userId: o.userId }))
        .sort(byName),
      ...staff
        .filter((m) => m.status === 'Activo')
        .map((m): Reporter => ({ key: `staff:${m.id}`, name: m.fullName, contact: m.phone || m.email || '', group: 'staff', label: `${m.fullName} · ${m.position}` }))
        .sort(byName),
    ]);
  }
}
