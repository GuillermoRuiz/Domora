import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CommunityScopeService } from '../../../core/community-scope.service';
import { EstatesService } from '../../../core/estates.service';
import { InsuranceClaimsService } from '../../../core/insurance-claims.service';
import {
  ClaimStatus,
  InsuranceClaimView,
  closeBlockedMessage,
} from '../../../core/insurance-claims.models';
import { InteractionForm, InteractionParty, MilestoneChoice, RegisterInteractionBody, milestoneChoices } from '../../../core/issue-interaction.builder';
import { IssueVisitsService, type IssueVisitView } from '../../../core/issue-visits.service';
import { IssueWorkflowService } from '../../../core/issue-workflow.service';
import {
  AttentionTask,
  BALL_LABEL,
  IssueSituationKey,
  IssueSituationView,
  JourneyActionType,
  ROUTE_LABEL,
  isResolutionRoute,
  routeLabel,
  ResolutionRoute,
  SITUATION_LABEL,
  describeNextStep,
  holderText,
} from '../../../core/issue-workflow.models';
import { AgendaTasksService } from '../../../core/agenda-tasks.service';
import { IssuesService } from '../../../core/issues.service';
import { Estate, Issue, IssueProviderAssignment, IssueStatus } from '../../../core/models';
import { StateService } from '../../../core/state.service';
import { SuppliersStaffService } from '../../../core/suppliers-staff.service';
import { TopbarComponent } from '../../../layout/topbar/topbar.component';
import { BtnComponent } from '../../../shared/components/btn/btn.component';
import { IssueJourneyComponent } from '../issue-journey/issue-journey.component';
import { ReviewTaskRef } from '../../tasks/review-next-step-panel/review-next-step-panel.component';
import { ReviewDecisionDialogComponent } from '../review-decision-dialog/review-decision-dialog.component';
import { ConfirmDialogService } from '../../../shared/components/confirm-dialog/confirm-dialog.service';
import { SelectDropdownDirective } from '../../../shared/components/dropdown/select-dropdown.directive';
import { DropdownComponent, DropdownItem } from '../../../shared/components/dropdown/dropdown.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { IssueClaimsBlockComponent } from '../issue-claims-block.component';
import { IssueEditDialogComponent, IssueEditKind } from '../issue-edit-dialog/issue-edit-dialog.component';
import { RouteChoice, RouteDialogComponent } from '../route-dialog/route-dialog.component';
import { taskTitleWithoutRef } from '../issue-situation-block.component';
import { IssueTimelineComponent } from '../issue-timeline.component';
import { IssueVisitsBlockComponent } from '../issue-visits-block.component';
import { InformRequesterDialogComponent } from '../inform-requester-dialog/inform-requester-dialog.component';
import { RequestInfoDialogComponent } from '../request-info-dialog/request-info-dialog.component';
import {
  DirectorySupplier,
  OpenWait,
  RegisterInteractionDialogComponent,
} from '../register-interaction-dialog/register-interaction-dialog.component';

const STATUSES: IssueStatus[] = ['Abierta', 'En reparación', 'Pendiente proveedor', 'Resuelta', 'Cerrada'];
/** Sin terminar: `Pendiente de información` también (se espera la respuesta de quien avisó). */
const ACTIVE: IssueStatus[] = ['Abierta', 'En reparación', 'Pendiente proveedor', 'Pendiente de información'];

/** Qué significa cada situación, en una frase para el administrador (el detalle de «qué pasa» lo da el siguiente paso). */
const SITUATION_TEXT: Record<IssueSituationKey, string> = {
  requires_attention: 'Hay una decisión pendiente de tu parte.',
  waiting_third_party: 'Un tercero tiene la gestión de la incidencia.',
  stalled: 'La incidencia sigue abierta y nadie tiene prevista ninguna actuación.',
  completed: 'La incidencia ya no requiere ninguna actuación.',
  no_pending_action: 'No hay nada pendiente por ahora.',
};

const BALL_ICON: Record<string, string> = {
  administration: 'user',
  provider: 'wrench',
  insurer: 'shield',
  owner: 'home',
  other: 'users',
  nobody: 'clock',
};

const dateTime = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const shortDate = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/**
 * Expediente de una incidencia (`/b/incidencias/:id`): lo que el administrador necesita para llevarla — situación, quién
 * tiene la pelota y siguiente paso — y, a la derecha, con quién y dónde. No calcula nada: pinta la proyección del
 * servidor (`IssueSituationService`) y cada acción pasa por los servicios de siempre, tras la que se vuelve a leer el
 * expediente. Proveedor y presupuesto se siguen editando en la ficha de la finca.
 */
@Component({
  selector: 'app-issue-detail-page',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    SelectDropdownDirective,
    TopbarComponent,
    BtnComponent,
    IssueJourneyComponent,
    ReviewDecisionDialogComponent,
    IconComponent,
    RouteDialogComponent,
    DropdownComponent,
    IssueClaimsBlockComponent,
    IssueVisitsBlockComponent,
    IssueTimelineComponent,
    RegisterInteractionDialogComponent,
    InformRequesterDialogComponent,
    RequestInfoDialogComponent,
    IssueEditDialogComponent,
  ],
  templateUrl: './issue-detail-page.component.html',
  styleUrl: './issue-detail-page.component.scss',
})
export class IssueDetailPageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly issuesApi = inject(IssuesService);
  private readonly estatesApi = inject(EstatesService);
  private readonly workflow = inject(IssueWorkflowService);
  private readonly claimsApi = inject(InsuranceClaimsService);
  private readonly visitsApi = inject(IssueVisitsService);
  private readonly suppliersApi = inject(SuppliersStaffService);
  private readonly agendaApi = inject(AgendaTasksService);
  private readonly state = inject(StateService);
  private readonly communityScope = inject(CommunityScopeService);
  private readonly confirmDialog = inject(ConfirmDialogService);
  private destroyed = false;
  private loadVersion = 0;

  /** Estados a elegir en «Estado actual»; si el vigente es otro (p. ej. «Pendiente de información») también se muestra. */
  readonly statusItems = computed<DropdownItem[]>(() => {
    const current = this.issue()?.status;
    const all: string[] = current && !STATUSES.includes(current) ? [...STATUSES, current] : STATUSES;
    return all.map((status) => ({ id: status, label: status }));
  });
  /** Color del estado: abierta en rojo, cerrada o resuelta en verde y el resto de estados intermedios en ámbar. */
  readonly statusTone = computed<'open' | 'progress' | 'done' | 'muted'>(() => {
    switch (this.issue()?.status) {
      case 'Abierta':
        return 'open';
      case 'Resuelta':
      case 'Cerrada':
        return 'done';
      case 'Retirada':
        return 'muted';
      default:
        return 'progress';
    }
  });
  readonly routeLabels = ROUTE_LABEL;
  readonly routeText = routeLabel;
  readonly currentRoute = computed<ResolutionRoute | null>(() => {
    const route = this.issue()?.resolutionRoute;
    return isResolutionRoute(route) ? route : null;
  });
  readonly issueId = signal('');
  readonly issue = signal<Issue | null>(null);
  readonly estate = signal<Estate | null>(null);
  /** Comunidades del selector de la cabecera; hasta que llegue la lista se usan las últimas conocidas. */
  private readonly estates = signal<Estate[]>([]);
  readonly estateOptions = computed(() => (this.estates().length ? this.estates() : this.communityScope.cachedEstates()));
  readonly situation = signal<IssueSituationView | null>(null);
  readonly claims = signal<InsuranceClaimView[]>([]);
  readonly visits = signal<IssueVisitView[]>([]);
  readonly provider = signal<IssueProviderAssignment | null>(null);
  readonly photos = signal<{ id: string; url: string }[]>([]);
  readonly loading = signal(true);
  readonly notFound = signal(false);
  readonly error = signal('');
  /** Aviso bajo la cabecera cuando un cambio de estado se rechaza (siniestro abierto…): se explica, no es un fallo de carga. */
  readonly notice = signal('');
  readonly toast = signal<string | null>(null);
  readonly moreMenu = signal(false);
  readonly showAllPhotos = signal(false);
  readonly saving = signal(false);
  readonly noteText = signal('');
  /** La nota que se escribe es interna: solo la ve la gestión, nunca quien reportó ni los vecinos. */
  readonly noteInternal = signal(false);

  readonly active = computed(() => ACTIVE.includes(this.issue()?.status as IssueStatus));
  readonly showClaims = computed(() => this.claims().length > 0);
  readonly attentionTask = computed<AttentionTask | null>(() => {
    const view = this.situation();
    return view?.situation === 'requires_attention' ? (view.attention.tasks[0] ?? null) : null;
  });
  /** La tarea abierta de esta incidencia en Tareas (la que pide intervención o, si no, la que marca el siguiente paso). */
  readonly linkedTask = computed<AttentionTask | null>(() => this.attentionTask() ?? this.situation()?.nextStep.task ?? null);
  /** La revisión pendiente de la incidencia: su decisión («¿cómo sigue?») se toma aquí mismo, sin pasar por Tareas. */
  readonly reviewTask = computed<ReviewTaskRef | null>(() => {
    const issue = this.issue();
    const task = this.linkedTask();
    if (!issue || !task || task.kind !== 'review_issue' || !this.active()) return null;
    return { id: task.id, issueId: issue.id, estate: issue.estateId ? { id: issue.estateId } : null };
  });
  /** Lo que se sugiere hacer primero (el título de la tarea de revisión): preselecciona «Tengo que hacer algo». */
  readonly showDecision = signal(false);
  readonly visiblePhotos = computed(() => (this.showAllPhotos() ? this.photos() : this.photos().slice(0, 3)));
  readonly requester = computed(() => {
    const issue = this.issue();
    if (!issue) return null;
    const report = issue.reports?.[0];
    return {
      name: issue.owner || report?.reporterName || '',
      origin: issue.source,
      receivedAt: report?.receivedAt ?? null,
    };
  });

  // Cómo se lee la proyección del servidor
  readonly situationLabel = computed(() => (this.situation() ? SITUATION_LABEL[this.situation()!.situation] : ''));
  readonly situationText = computed(() => (this.situation() ? SITUATION_TEXT[this.situation()!.situation] : ''));
  readonly ball = computed(() => {
    const view = this.situation();
    const [first, ...rest] = view?.ballInCourt.holders ?? [];
    if (!first) return { icon: BALL_ICON['nobody'], who: BALL_LABEL.nobody, text: '', more: [] as string[] };
    const named = first.party !== 'administration';
    return {
      icon: BALL_ICON[first.party],
      who: BALL_LABEL[first.party],
      text: named ? holderText(first).replace(`${BALL_LABEL[first.party]} · `, '') : (first.label ?? ''),
      more: rest.map(holderText),
    };
  });
  readonly nextStep = computed(() => {
    const view = this.situation();
    if (!view) return { icon: 'clock', headline: '', text: '', when: null as string | null };
    const step = describeNextStep(view.nextStep, view.situation);
    const task = this.attentionTask();
    return {
      icon: view.nextStep.kind === 'visit' ? 'calendar' : view.nextStep.kind === 'human' ? 'file-text' : 'arrow-right',
      headline: step.headline,
      text: task ? taskTitleWithoutRef(task.title) : step.text,
      when: step.when,
    };
  });

  // ── Gestiones ──────────────────────────────────────────────────────
  readonly showRegister = signal(false);
  readonly showInform = signal(false);
  readonly showAskInfo = signal(false);
  readonly askInfoBusy = signal(false);
  readonly askInfoError = signal('');
  /** Qué dato del expediente se está editando (proveedor, presupuesto o instalación). */
  readonly editing = signal<IssueEditKind | null>(null);
  readonly registerParty = signal<InteractionParty>('provider');
  readonly registerOpenClaim = signal(false);
  readonly registerPreset = signal<Partial<InteractionForm>>({});
  readonly interactionBusy = signal(false);
  readonly interactionError = signal('');
  readonly routeSaving = signal(false);
  readonly showRoute = signal(false);
  readonly claimBusy = signal(false);
  readonly visitBusy = signal(false);
  readonly visitError = signal('');
  readonly directory = signal<DirectorySupplier[]>([]);
  /** Equipo al que se puede asignar la tarea de seguimiento de «Registrar actividad». */
  readonly assignees = signal<{ id: string; name: string }[]>([]);
  private assigneesRequested = false;
  readonly milestones = signal<MilestoneChoice[]>([]);
  private directoryRequested = false;
  readonly openWaits = computed<OpenWait[]>(() =>
    (this.situation()?.ballInCourt.holders ?? [])
      .filter((h) => h.source === 'wait')
      .map((h) => ({ id: h.refId, party: h.party as OpenWait['party'], label: h.label })),
  );
  readonly plannedVisitAt = computed(() => this.situation()?.ballInCourt.holders.find((h) => h.source === 'visit')?.dueAt ?? null);
  readonly counterpart = computed(
    () => this.situation()?.ballInCourt.holders.find((h) => h.party !== 'administration' && h.label)?.label ?? '',
  );
  /** La gestión pidió información y la respuesta de quien avisó sigue pendiente. */
  readonly waitingForRequester = computed(() => this.issue()?.status === 'Pendiente de información');
  /** Hay una persona con cuenta a la que avisar: quien reportó la incidencia. Nunca se avisa a todos los residentes. */
  readonly canInform = computed(() => this.active() && !!this.issue()?.reports?.some((r) => !!r.reporterUserId));

  ngOnInit(): void {
    void this.estatesApi.listEstates().then((estates) => {
      if (!this.destroyed) this.estates.set(estates);
    }, () => undefined);
    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
      this.photos().forEach((p) => URL.revokeObjectURL(p.url));
    });
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      this.issueId.set(params.get('id') ?? '');
      void this.load();
    });
  }

  /** Lee el expediente completo. Tras cada acción es la fuente de la verdad: se pinta lo que el servidor ha calculado. */
  async load(quiet = false): Promise<void> {
    const id = this.issueId();
    const version = ++this.loadVersion;
    if (!quiet) this.loading.set(true);
    this.error.set('');
    try {
      const [issue, situation, claims, visits, provider] = await Promise.all([
        this.issuesApi.findIssueById(id),
        this.workflow.situation(id).catch(() => null),
        this.claimsApi.list(id).catch(() => null),
        this.visitsApi.list(id).catch(() => null),
        this.issuesApi.currentIssueProvider(id).catch(() => null),
      ]);
      if (this.destroyed || version !== this.loadVersion) return;
      if (!issue) {
        this.notFound.set(true);
        return;
      }
      this.notFound.set(false);
      this.issue.set(issue);
      this.situation.set(situation);
      if (claims) this.claims.set(claims);
      if (visits) this.visits.set(visits);
      this.provider.set(provider);
      void this.loadPhotos(issue);
      void this.loadEstate(issue.estateId);
    } catch {
      if (!this.destroyed && version === this.loadVersion)
        this.error.set('No se pudo cargar la incidencia. Inténtalo de nuevo.');
    } finally {
      if (!this.destroyed && version === this.loadVersion) this.loading.set(false);
    }
  }

  /** Una incidencia es de una sola comunidad: elegir otra en la cabecera lleva al listado de esa comunidad. */
  changeCommunity(estateId: string): void {
    this.communityScope.select(estateId || null);
    void this.router.navigate(['/b/incidencias'], { queryParams: estateId ? { estateId } : {} });
  }

  private async loadEstate(estateId: string | undefined): Promise<void> {
    if (!estateId || this.estate()?.id === estateId) return;
    const estate = await this.estatesApi.findEstateById(estateId).catch(() => null);
    if (this.destroyed || !estate) return;
    this.estate.set(estate);
  }

  private async loadPhotos(issue: Issue): Promise<void> {
    // El endpoint exige sesión: las fotos se bajan como blob y se enseñan con su object URL.
    const known = new Set(this.photos().map((p) => p.id));
    const loaded: { id: string; url: string }[] = [];
    for (const photo of issue.photos) {
      if (known.has(photo.id)) continue;
      try {
        loaded.push({ id: photo.id, url: URL.createObjectURL(await this.issuesApi.issuePhotoBlob(issue.id, photo.id)) });
      } catch {
        // Una foto que no baja no impide leer el expediente.
      }
    }
    if (this.destroyed) loaded.forEach((p) => URL.revokeObjectURL(p.url));
    else if (loaded.length) this.photos.update((all) => [...all, ...loaded]);
  }

  showToast(message: string, ms = 2500): void {
    this.toast.set(message);
    setTimeout(() => this.toast.set(null), ms);
  }

  /** Decidido el siguiente paso: el expediente y «Situación actual» se releen para mostrar lo que se acaba de crear. */
  async onReviewResolved(): Promise<void> {
    this.showDecision.set(false);
    await this.refreshAfterAction();
  }

  /** Tras una gestión: expediente, situación y los contadores globales al día. */
  private async refreshAfterAction(): Promise<void> {
    await this.load(true);
    this.state.bumpNotifications();
  }

  // ── Estado ─────────────────────────────────────────────────────────
  async changeStatus(status: IssueStatus): Promise<void> {
    const issue = this.issue();
    if (!issue || this.saving() || status === issue.status) return;
    this.saving.set(true);
    this.notice.set('');
    try {
      await this.issuesApi.updateIssueStatus(issue.id, status);
      await this.refreshAfterAction();
      this.showToast(`Incidencia actualizada a «${status}»`);
    } catch (error) {
      // Cerrar con un siniestro abierto o la comunicación al solicitante por decidir: se explica; no es un fallo de carga.
      const blocked = closeBlockedMessage(error);
      this.notice.set(blocked ?? 'No se pudo actualizar el estado.');
      await this.load(true);
    } finally {
      this.saving.set(false);
    }
  }

  statusTheme(status: string): string {
    if (status === 'Abierta') return 'blue';
    if (status === 'En reparación') return 'gold';
    if (status === 'Pendiente proveedor') return 'orange';
    if (status === 'Pendiente de información') return 'purple';
    if (status === 'Resuelta') return 'green';
    return 'gray';
  }

  toggleMoreMenu(event: Event): void {
    event.stopPropagation();
    this.moreMenu.update((open) => !open);
  }
  closeMenus(): void {
    this.moreMenu.set(false);
  }

  // ── Situación, vía, siniestros y visitas ───────────────────────────
  openTask(task: AttentionTask): void {
    void this.router.navigateByUrl(task.route);
  }

  /** «Eliminar incidencia»: tras confirmarlo se borra y se vuelve al listado. */
  async deleteIssue(): Promise<void> {
    this.closeMenus();
    const issue = this.issue();
    if (!issue || this.saving()) return;
    const confirmed = await this.confirmDialog.ask({
      title: 'Eliminar incidencia',
      message: `Se eliminará ${issue.ref} · ${issue.title}, con sus tareas, esperas y visitas pendientes. La incidencia dejará de verse para todos.`,
      confirmLabel: 'Eliminar incidencia',
      cancelLabel: 'Volver',
      tone: 'danger',
    });
    if (!confirmed) return;
    this.saving.set(true);
    try {
      await this.issuesApi.deleteIssue(issue.id);
      await this.router.navigate(['/b/incidencias'], issue.estateId ? { queryParams: { estateId: issue.estateId } } : {});
    } catch {
      this.showToast('No se pudo eliminar la incidencia');
    } finally {
      this.saving.set(false);
    }
  }

  /** «Resolver vía» del menú de tres puntos: abre la ventana con el desplegable. */
  openRoute(): void {
    this.closeMenus();
    this.showRoute.set(true);
  }

  async saveRoute(choice: RouteChoice): Promise<void> {
    await this.changeRoute(choice.route, choice.reason);
    this.showRoute.set(false);
  }

  async changeRoute(route: ResolutionRoute | null, reason?: string): Promise<void> {
    if (this.routeSaving()) return;
    this.routeSaving.set(true);
    try {
      await this.workflow.decideRoute(this.issueId(), route, reason);
      await this.refreshAfterAction();
      this.showToast('Vía de gestión actualizada');
    } catch {
      this.showToast('No se pudo cambiar la vía de gestión');
    } finally {
      this.routeSaving.set(false);
    }
  }

  openClaimRegister(openClaim: boolean): Promise<void> {
    return this.openRegister(this.issue()?.resolutionRoute === 'owner_insurance' ? 'owner' : 'insurer', openClaim);
  }

  async changeClaimStatus(change: { claimId: string; status: ClaimStatus }): Promise<void> {
    if (this.claimBusy()) return;
    this.claimBusy.set(true);
    try {
      await this.claimsApi.update(this.issueId(), change.claimId, { status: change.status });
      await this.refreshAfterAction();
      this.showToast('Estado del siniestro actualizado');
    } catch (error) {
      const message = (error as { error?: { message?: string | string[] } })?.error?.message;
      this.showToast(Array.isArray(message) ? message.join(' ') : (message ?? 'No se pudo cambiar el estado del siniestro'));
    } finally {
      this.claimBusy.set(false);
    }
  }

  async recordVisitOutcome(change: { visitId: string; outcome: 'completed' | 'cancelled' }): Promise<void> {
    await this.changeVisit(
      () => this.visitsApi.recordOutcome(this.issueId(), change.visitId, change.outcome),
      change.outcome === 'completed' ? 'Visita registrada como realizada' : 'Visita cancelada',
    );
  }

  async rescheduleVisit(change: { visitId: string; scheduledAt: string }): Promise<void> {
    await this.changeVisit(() => this.visitsApi.reschedule(this.issueId(), change.visitId, change.scheduledAt), 'Visita reprogramada');
  }

  private async changeVisit(action: () => Promise<unknown>, done: string): Promise<void> {
    if (this.visitBusy()) return;
    this.visitBusy.set(true);
    this.visitError.set('');
    try {
      await action();
      await this.refreshAfterAction();
      this.showToast(done);
    } catch (error) {
      const message = (error as { error?: { message?: string | string[] } })?.error?.message;
      this.visitError.set((Array.isArray(message) ? message.join(' ') : message)?.trim() || 'No se pudo cambiar la visita. Vuelve a intentarlo.');
      // Aunque falle, lo que se ve tiene que ser lo que hay (otra persona pudo dar ya su resultado).
      void this.load(true);
    } finally {
      this.visitBusy.set(false);
    }
  }

  // ── Registrar gestión / informar al solicitante ────────────────────
  /** La acción del paso actual del recorrido: el recorrido solo la pide, cada pantalla hace lo suyo. */
  async onJourneyAction(action: { type: JourneyActionType; entityId?: string }): Promise<void> {
    switch (action.type) {
      case 'open_task':
        // «Ver tarea»: siempre al detalle de la tarea en Tareas (la revisión también se decide ahí).
        if (action.entityId) void this.router.navigate(['/b/tasks'], { queryParams: { task: action.entityId } });
        return;
      case 'register_response': {
        // Registrar la respuesta cierra la espera de esa parte.
        const wait = this.openWaits().find((w) => w.id === action.entityId);
        await this.openRegister(wait?.party ?? 'other', false, wait ? { party: wait.party, direction: 'inbound', closeWaitId: wait.id, partyLabel: wait.label ?? '' } : {});
        return;
      }
      case 'manage_visit':
        this.scrollToBlock('app-issue-visits-block');
        return;
      case 'manage_claim':
        this.scrollToBlock('app-issue-claims-block');
        return;
      case 'change_route':
        this.openRoute();
        return;
      case 'close_issue':
        // «Completar» en «Incidencia cerrada»: se completa el hito y la incidencia pasa a Cerrada.
        await this.changeStatus('Cerrada');
        return;
      case 'resolve_issue':
        await this.openRegister('other', false, { nextStep: 'resolved' });
        return;
      case 'register_activity':
        await this.openRegister();
        return;
    }
  }

  private scrollToBlock(selector: string): void {
    document.querySelector(selector)?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  }

  async openRegister(party: InteractionParty = 'provider', openClaim = false, preset: Partial<InteractionForm> = {}): Promise<void> {
    this.registerPreset.set(preset);
    this.closeMenus();
    this.interactionError.set('');
    this.registerParty.set(party);
    this.registerOpenClaim.set(openClaim);
    this.showRegister.set(true);
    void this.ensureAssignees();
    void this.loadMilestones();
    await this.ensureDirectory();
  }

  /** Los hitos del recorrido, para que la tarea nueva se asocie a uno. */
  private async loadMilestones(): Promise<void> {
    const id = this.issue()?.id;
    if (!id) return;
    try {
      const view = await this.workflow.journey(id);
      if (!this.destroyed && Array.isArray(view?.steps)) this.milestones.set(milestoneChoices(view.steps));
    } catch {
      // Sin la lista no se puede asociar la tarea: el formulario lo pide y no deja guardar sin hito.
    }
  }

  private async ensureAssignees(): Promise<void> {
    if (this.assigneesRequested) return;
    this.assigneesRequested = true;
    try {
      const people = await this.agendaApi.listAssignees();
      if (!this.destroyed) this.assignees.set(people.map((p) => ({ id: p.id, name: p.fullName })));
    } catch {
      // Sin la lista se puede registrar igualmente: la tarea queda sin asignar.
      this.assigneesRequested = false;
    }
  }

  private async ensureDirectory(): Promise<void> {
    const estateId = this.issue()?.estateId;
    if (this.directoryRequested || !estateId) return;
    this.directoryRequested = true;
    try {
      const suppliers = await this.suppliersApi.listSuppliers(estateId);
      if (!this.destroyed)
        this.directory.set(suppliers.filter((s) => s.status === 'Activo').map((s) => ({ id: s.id, name: s.name, category: s.category })));
    } catch {
      // Sin directorio se puede registrar igualmente escribiendo el nombre.
      this.directoryRequested = false;
    }
  }

  openInform(): void {
    this.closeMenus();
    this.interactionError.set('');
    this.showInform.set(true);
  }

  openAskInfo(): void {
    this.closeMenus();
    this.askInfoError.set('');
    this.showAskInfo.set(true);
  }

  /** «Pedir información»: la incidencia pasa a «Pendiente de información» y se avisa a quienes la reportaron. */
  async submitAskInfo(text: string): Promise<void> {
    if (this.askInfoBusy()) return;
    this.askInfoBusy.set(true);
    this.askInfoError.set('');
    try {
      await this.issuesApi.requestIssueInfo(this.issueId(), text);
      this.showAskInfo.set(false);
      await this.refreshAfterAction();
      this.showToast('Información solicitada');
    } catch (error) {
      const message = (error as { error?: { message?: string | string[] } })?.error?.message;
      this.askInfoError.set(Array.isArray(message) ? message.join(' ') : (message ?? 'No se pudo pedir la información. Inténtalo de nuevo.'));
    } finally {
      this.askInfoBusy.set(false);
    }
  }

  async submitRegister(body: RegisterInteractionBody): Promise<void> {
    await this.sendInteraction(body, () => this.showRegister.set(false), 'Gestión registrada');
  }
  async submitInform(body: RegisterInteractionBody): Promise<void> {
    await this.sendInteraction(body, () => this.showInform.set(false), 'Solicitante informado');
  }

  private async sendInteraction(body: RegisterInteractionBody, done: () => void, toast: string): Promise<void> {
    if (this.interactionBusy()) return;
    this.interactionBusy.set(true);
    this.interactionError.set('');
    try {
      await this.workflow.registerInteraction(this.issueId(), body);
      done();
      await this.refreshAfterAction();
      this.showToast(toast);
    } catch (error) {
      const message = (error as { error?: { message?: string | string[] } })?.error?.message;
      this.interactionError.set(Array.isArray(message) ? message.join(' ') : (message ?? 'No se pudo registrar. Inténtalo de nuevo.'));
    } finally {
      this.interactionBusy.set(false);
    }
  }

  // ── Historial ──────────────────────────────────────────────────────
  async addNote(): Promise<void> {
    const issue = this.issue();
    const text = this.noteText().trim();
    if (!issue || !text) return;
    try {
      const internal = this.noteInternal();
      const entry = await this.issuesApi.addIssueTimelineEntry(issue.id, text, { internal });
      this.issue.set({ ...issue, timeline: [{ ...entry, internal }, ...issue.timeline] });
      this.noteText.set('');
      this.noteInternal.set(false);
      this.showToast(internal ? 'Nota interna añadida' : 'Actualización añadida');
    } catch {
      this.showToast('No se pudo añadir la actualización');
    }
  }

  // ── Textos ─────────────────────────────────────────────────────────
  day(date: string | undefined | null): string {
    const value = date ? new Date(date) : null;
    return value && Number.isFinite(value.getTime()) ? shortDate.format(value).replace(/\./g, '') : '—';
  }
  /** Última actividad: lo más reciente entre el último cambio de la incidencia y su último apunte del historial. */
  lastUpdate(): string {
    const issue = this.issue();
    if (!issue) return '—';
    const times = [issue.updatedAt, ...issue.timeline.map((e) => e.date)]
      .map((d) => (d ? new Date(d).getTime() : NaN))
      .filter((t) => Number.isFinite(t));
    return times.length ? dateTime.format(new Date(Math.max(...times))).replace(/\./g, '') : '—';
  }
  providerDate(): string | null {
    const raw = this.provider()?.estimatedResolutionDate;
    return raw ? this.day(raw) : null;
  }
  /** Zona o instalación afectada: la instalación vinculada por la gestión y, si no, la zona que indicó quien avisó. */
  location(): string {
    const issue = this.issue();
    return issue?.asset?.name || issue?.location || 'Zona común';
  }
  openEdit(kind: IssueEditKind): void {
    this.closeMenus();
    this.editing.set(kind);
  }
  async editSaved(message: string): Promise<void> {
    this.editing.set(null);
    await this.refreshAfterAction();
    this.showToast(message);
  }
}
