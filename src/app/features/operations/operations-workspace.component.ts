import {
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import {
  OperationsService,
  type OperationPage,
  type OperationQuery,
  type OperationRow,
  type OperationsKind,
} from '../../core/operations.service';
import { CommunityScopeService } from '../../core/community-scope.service';
import { EstatesService } from '../../core/estates.service';
import { StateService } from '../../core/state.service';
import { IssuesService } from '../../core/issues.service';
import { ConfirmDialogService } from '../../shared/components/confirm-dialog/confirm-dialog.service';
import {
  closeBlockedMessage,
} from '../../core/insurance-claims.models';
import type {
  Estate,
  Issue,
  IssueStatus,
  Meeting,
} from '../../core/models';
import { TopbarComponent } from '../../layout/topbar/topbar.component';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { BtnComponent } from '../../shared/components/btn/btn.component';
import { SelectDropdownDirective } from '../../shared/components/dropdown/select-dropdown.directive';
import { CreateJuntaModalComponent } from '../estate-detail/juntas-tab/create-junta-modal/create-junta-modal.component';
import { MeetingWorkspaceComponent } from './meeting-workspace/meeting-workspace.component';
import { IssuesListComponent, type IssuesListQuery } from './issues-list/issues-list.component';
import { NewIssueDialogComponent } from '../issues/new-issue-dialog/new-issue-dialog.component';
import { ISSUE_LIST_FILTERS } from '../../core/issue-workflow.models';

@Component({
  selector: 'app-operations-workspace',
  standalone: true,
  imports: [
    FormsModule,
    SelectDropdownDirective,
    TopbarComponent,
    IconComponent,
    BtnComponent,
    CreateJuntaModalComponent,
    MeetingWorkspaceComponent,
    IssuesListComponent,
    NewIssueDialogComponent,
  ],
  templateUrl: './operations-workspace.component.html',
  styleUrl: './operations-workspace.component.scss',
})
export class OperationsWorkspaceComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(OperationsService);
  private readonly estatesApi = inject(EstatesService);
  private readonly issuesApi = inject(IssuesService);
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly state = inject(StateService);
  readonly kind = this.route.snapshot.data['operationsKind'] as OperationsKind;
  readonly isMeetings = this.kind === 'meetings';
  readonly title = this.isMeetings ? 'Juntas' : 'Incidencias';
  readonly newLabel = this.isMeetings ? 'Nueva junta' : 'Nueva incidencia';
  readonly estates = signal<Estate[]>([]);
  private readonly communityScope = inject(CommunityScopeService);
  private scopeApplied = false;
  readonly estateOptions = computed(() => this.estates().length ? this.estates() : this.communityScope.cachedEstates());
  readonly estateId = signal('');
  readonly search = signal('');
  readonly filter = signal('all');
  readonly sort = signal('newest');
  /** Solo Incidencias: estado del expediente, situación exacta, quién tiene la pelota y antigüedad. */
  readonly status = signal('');
  readonly situation = signal('');
  readonly ball = signal('');
  readonly created = signal('');
  readonly assetId = signal('');
  readonly page = signal(1);
  readonly loading = signal(true);
  /** Ya llegó (o falló) la primera respuesta: desde ahí, volver a pedir los datos es un refresco, no una carga inicial. */
  readonly loaded = signal(false);
  /** Primera carga, sin nada que enseñar todavía: es lo único que puede dejar el listado en blanco. */
  readonly initialLoading = computed(() => this.loading() && !this.loaded());
  /** Cambio de filtro, búsqueda u orden: se conserva lo que hay en pantalla hasta que llegue lo nuevo. */
  readonly refreshing = computed(() => this.loading() && this.loaded());
  readonly error = signal('');
  readonly saving = signal(false);
  readonly data = signal<OperationPage>({
    items: [],
    total: 0,
    page: 1,
    pageSize: 12,
    summary: {},
  });
  readonly selectedId = signal<string | null>(null);
  readonly linkedMeeting = signal<OperationRow | null>(null);
  readonly selectionError = signal('');
  readonly selected = computed<OperationRow | null>(() =>
    this.selectedId()
      ? (this.data().items.find((row) => row.id === this.selectedId()) ??
        this.linkedMeeting())
      : (this.data().items[0] ?? null),
  );
  /** Junta que se está editando en el asistente (solo Juntas). */
  readonly editingMeeting = signal<Meeting | null>(null);
  /** `null` = asistente cerrado; `''` = abierto sin comunidad (se elige en su paso 1). */
  readonly creationEstateId = signal<string | null>(null);
  /** Comunidad de la incidencia que se está creando; `null` = diálogo cerrado, `''` = abierto sin comunidad (se elige en él). */
  readonly newIssueEstateId = signal<string | null>(null);
  private requestVersion = 0;
  private inFlight?: AbortController;
  private searchTimer?: ReturnType<typeof setTimeout>;
  private destroyed = false;
  readonly pageCount = computed(() =>
    Math.max(1, Math.ceil(this.data().total / this.data().pageSize)),
  );
  readonly filters = [
    { id: 'all', label: 'Todas' },
    { id: 'convocada', label: 'Convocadas' },
    { id: 'celebrada', label: 'Celebradas' },
    { id: 'firmada', label: 'Firmadas' },
    { id: 'cancelada', label: 'Canceladas' },
  ];
  /** Lo que el listado de Incidencias necesita saber de la URL. */
  readonly issuesQuery = computed<IssuesListQuery>(() => ({
    search: this.search(),
    filter: this.filter(),
    sort: this.sort(),
    estateId: this.estateId(),
    status: this.status(),
    situation: this.situation(),
    ball: this.ball(),
    created: this.created(),
    assetId: this.assetId(),
  }));
  readonly metrics = computed(() =>
    [
      { key: 'convocada', label: 'Convocadas', icon: 'calendar', tone: 'blue' },
      { key: 'celebrada', label: 'Celebradas', icon: 'check', tone: 'gold' },
      { key: 'firmada', label: 'Firmadas', icon: 'file-text', tone: 'green' },
      { key: 'cancelada', label: 'Canceladas', icon: 'x', tone: 'muted' },
    ].map((metric) => ({
      ...metric,
      value: this.data().summary[metric.key] ?? 0,
    })),
  );
  readonly issueStatuses: IssueStatus[] = [
    'Abierta',
    'En reparación',
    'Pendiente proveedor',
    'Resuelta',
    'Cerrada',
  ];

  ngOnInit(): void {
    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
      this.inFlight?.abort();
      clearTimeout(this.searchTimer);
    });
    void this.estatesApi
      .listEstates()
      .then((estates) => {
        if (!this.destroyed) this.estates.set(estates);
      })
      .catch(() => {
        if (!this.destroyed)
          this.error.set(
            'No se pudieron cargar las comunidades. Recarga la página para volver a intentarlo.',
          );
      });
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        if (!this.scopeApplied) {
          this.scopeApplied = true;
          const shared = this.communityScope.estateId();
          if (!params.has('estateId') && shared) { this.estateId.set(shared); this.setQuery({ estateId: shared }); return; }
        }
        if (params.has('estateId')) this.communityScope.select(params.get('estateId') || null);
        this.estateId.set(params.get('estateId') ?? '');
        this.search.set(params.get('search') ?? '');
        const filter = params.get('filter') ?? 'all';
        // Enlaces antiguos de Incidencias usaban otros filtros (`open`, `active`…): se leen como «Todas».
        this.filter.set(
          this.isMeetings || ISSUE_LIST_FILTERS.some((f) => f.key === filter) ? filter : 'all',
        );
        this.status.set(params.get('status') ?? '');
        this.situation.set(params.get('situation') ?? '');
        this.ball.set(params.get('ball') ?? '');
        this.created.set(params.get('created') ?? '');
        this.assetId.set(params.get('assetId') ?? '');
        this.sort.set(params.get('sort') ?? 'newest');
        this.page.set(Math.max(1, Number(params.get('page')) || 1));
        this.selectedId.set(params.get('entity'));
        this.linkedMeeting.set(null);
        void this.reload();
      });
  }
  setQuery(patch: Record<string, string | number | null>): void {
    clearTimeout(this.searchTimer);
    if ('estateId' in patch) this.communityScope.select(patch['estateId'] ? String(patch['estateId']) : null);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        search: this.search() || null,
        ...patch,
        page: patch['page'] ?? 1,
        entity: null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
  onSearch(value: string): void {
    this.search.set(value);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(
      () => this.setQuery({ search: value || null }),
      250,
    );
  }
  clearFilters(): void {
    this.setQuery({
      search: null,
      filter: null,
      estateId: null,
      sort: null,
      status: null,
      situation: null,
      ball: null,
      created: null,
      assetId: null,
    });
  }
  select(row: OperationRow): void {
    this.selectedId.set(row.id);
    this.linkedMeeting.set(null);
    this.selectionError.set('');
  }
  meetingEdited(): void {
    this.onMeetingChanged();
  }
  onMeetingChanged(): void {
    void this.reload();
  }
  async reload(): Promise<void> {
    const version = ++this.requestVersion;
    // Una petición nueva sustituye a la anterior: se cancela, y su respuesta (si llegara) tampoco se aplicaría.
    this.inFlight?.abort();
    const controller = (this.inFlight = new AbortController());
    this.loading.set(true);
    this.error.set('');
    this.selectionError.set('');
    const query: OperationQuery = {
      estateId: this.estateId() || undefined,
      search: this.search(),
      filter: this.filter(),
      sort: this.sort(),
      page: this.page(),
      pageSize: 12,
      ...(this.isMeetings
        ? {}
        : {
            status: this.status() || undefined,
            situation: this.situation() || undefined,
            ball: this.ball() || undefined,
            assetId: this.assetId() || undefined,
          }),
      created: this.isMeetings ? undefined : this.created() || undefined,
    };
    try {
      const page = await this.api.list(this.kind, query, { signal: controller.signal });
      if (this.destroyed || version !== this.requestVersion) return;
      if (!page.items.length && page.total > 0 && this.page() > 1) {
        this.setQuery({ page: 1 });
        return;
      }
      this.data.set(page);
      const id = this.selectedId();
      if (this.isMeetings && id && !page.items.some((row) => row.id === id)) {
        // Conserva la junta ya enlazada: así el detalle no se desmonta al refrescar.
        if (this.linkedMeeting()?.id !== id) this.linkedMeeting.set(null);
        try {
          const meeting = await this.api.meeting(id);
          if (
            !this.destroyed &&
            version === this.requestVersion &&
            this.selectedId() === id
          )
            this.linkedMeeting.set(meeting);
        } catch {
          if (
            !this.destroyed &&
            version === this.requestVersion &&
            this.selectedId() === id
          )
            this.selectionError.set(
              'No se pudo abrir la junta solicitada. Puede que ya no exista o no tengas acceso.',
            );
        }
      }
    } catch {
      if (!this.destroyed && version === this.requestVersion)
        this.error.set(
          `No se pudieron cargar las ${this.title.toLowerCase()}. Inténtalo de nuevo.`,
        );
    } finally {
      if (!this.destroyed && version === this.requestVersion) {
        this.loading.set(false);
        this.loaded.set(true);
      }
    }
  }
  create(): void {
    const estate =
      this.estates().find((item) => item.id === this.estateId()) ??
      (this.estates().length === 1 ? this.estates()[0] : null);
    // Juntas e incidencias eligen la comunidad dentro de su propio asistente o diálogo cuando no hay una elegida.
    if (this.isMeetings) this.creationEstateId.set(estate?.id ?? '');
    else this.newIssueEstateId.set(estate?.id ?? '');
  }
  /** Las comunidades entre las que elegir al crear una incidencia. */
  readonly issueEstates = computed(() =>
    this.estates().map((e) => ({ id: e.id, name: e.name, address: e.address })),
  );
  issueCreated(issue: Issue): void {
    this.newIssueEstateId.set(null);
    this.state.bumpNotifications();
    void this.router.navigate(['/b/incidencias', issue.id]);
  }
  meetingCreated(meeting: Meeting): void {
    // El modal sigue montado: su paso de éxito (enlaces y contraseña de la
    // sala) se muestra tras `created` y cierra él mismo vía `closed`.
    this.selectedId.set(meeting.id);
    void this.reload();
  }
  openFullIssue(row: OperationRow): void {
    void this.router.navigate(['/b/incidencias', row.id]);
  }
  async updateIssueStatus(
    row: OperationRow,
    status: IssueStatus,
  ): Promise<void> {
    if (this.saving() || !this.issueStatuses.includes(status)) return;
    this.saving.set(true);
    try {
      await this.issuesApi.updateIssueStatus(row.id, status);
      await this.reload();
    } catch (error) {
      const blocked = closeBlockedMessage(error);
      if (blocked) {
        // No es un fallo de la lista: se explica junto a la selección y se vuelve a leer el estado real (el desplegable
        // no se queda en «Cerrada»).
        await this.reload();
        this.selectionError.set(blocked);
      } else {
        this.error.set('No se pudo actualizar el estado.');
      }
    } finally {
      this.saving.set(false);
    }
  }
  /** «Eliminar incidencia» del menú de la fila: borrado lógico, tras confirmarlo. */
  async deleteIssue(row: OperationRow): Promise<void> {
    if (this.saving()) return;
    const confirmed = await this.confirmDialog.ask({
      title: 'Eliminar incidencia',
      message: `Se eliminará ${row.ref} · ${row.title}, con sus tareas, esperas y visitas pendientes. La incidencia dejará de verse para todos.`,
      confirmLabel: 'Eliminar incidencia',
      cancelLabel: 'Volver',
      tone: 'danger',
    });
    if (!confirmed) return;
    this.saving.set(true);
    try {
      await this.issuesApi.deleteIssue(row.id);
      if (this.selectedId() === row.id) this.selectedId.set(null);
      await this.reload();
    } catch {
      this.error.set('No se pudo eliminar la incidencia.');
    } finally {
      this.saving.set(false);
    }
  }
  /** «Pendiente de información» and «Retirada» are not set by hand (the API rejects them). */
  isManualStatus(label: string): boolean {
    return this.issueStatuses.includes(label as IssueStatus);
  }
  openBeacon(row: OperationRow): void {
    void this.router.navigate(['/beacon', row.id]);
  }
  date(
    value: string,
    format: 'day' | 'month' | 'year' | 'full' | 'time' = 'full',
  ): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    const options: Intl.DateTimeFormatOptions =
      format === 'day'
        ? { day: '2-digit' }
        : format === 'year'
          ? { year: 'numeric' }
          : format === 'month'
            ? { month: 'short' }
            : format === 'time'
              ? { hour: '2-digit', minute: '2-digit' }
              : { day: 'numeric', month: 'long', year: 'numeric' };
    return new Intl.DateTimeFormat('es-ES', options).format(date);
  }
  address(row: OperationRow): string {
    return [
      [row.estate.address, row.estate.streetNumber].filter(Boolean).join(' '),
      row.estate.location,
    ]
      .filter(Boolean)
      .join(', ');
  }
}
