import { Component, OnInit, computed, input, output, signal } from '@angular/core';
import { BtnComponent } from '../../../shared/components/btn/btn.component';
import { DropdownComponent, DropdownItem } from '../../../shared/components/dropdown/dropdown.component';
import { SelectDropdownDirective } from '../../../shared/components/dropdown/select-dropdown.directive';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { supplierCategoryFor } from '../../../core/supplier-categories';
import {
  BuiltInteraction,
  CUSTOM_NOTICE,
  CUSTOM_NOTICE_MAX,
  INTERACTION_MEDIA,
  INTERACTION_PARTIES,
  InteractionForm,
  InteractionParty,
  NEXT_STEPS,
  NextStepChoice,
  REQUESTER_TEMPLATES,
  RegisterInteractionBody,
  RequesterTemplate,
  buildInteraction,
  displayPartyName,
  emptyInteractionForm,
} from '../../../core/issue-interaction.builder';
import { RESOLUTION_ROUTES, ROUTE_LABEL } from '../../../core/issue-workflow.models';
import { CLAIM_STATUSES, CLAIM_STATUS_LABEL, ClaimStatus, InsuranceClaimView, isClaimStatus, isLiveClaim } from '../../../core/insurance-claims.models';
import { PreviewState, RequesterNoticePreviewComponent } from '../requester-notice-preview.component';

export interface DirectorySupplier {
  id: string;
  name: string;
  category: string;
}
export interface OpenWait {
  id: string;
  party: 'provider' | 'insurer' | 'owner' | 'other';
  label: string | null;
}

/** Plazos para volver a mirar una espera (días); 0 = el plazo habitual de la política. */
export const WAIT_DAY_CHOICES = [
  { days: 0, label: 'Plazo habitual' },
  { days: 1, label: '1 día' },
  { days: 2, label: '2 días' },
  { days: 3, label: '3 días' },
  { days: 7, label: '1 semana' },
];

/**
 * «Registrar gestión»: deja constancia de algo ocurrido fuera de Domora (una llamada, un WhatsApp, una reunión…) y de
 * lo que de ello se deriva. La persona marca consecuencias con frases normales; `buildInteraction` las traduce a los
 * DTO tipados de `POST /issues/:id/interactions`. Las validaciones de dominio son del servidor: si rechaza algo, el
 * mensaje llega en `error`.
 */
@Component({
  selector: 'app-register-interaction-dialog',
  standalone: true,
  imports: [BtnComponent, IconComponent, RequesterNoticePreviewComponent, SelectDropdownDirective, DropdownComponent],
  templateUrl: './register-interaction-dialog.component.html',
  styleUrl: './register-interaction-dialog.component.scss',
})
export class RegisterInteractionDialogComponent implements OnInit {
  /** Incidencia sobre la que se registra (para pedir el texto exacto del aviso al solicitante). */
  readonly issueId = input.required<string>();
  /** Contraparte con la que se abre el formulario. */
  readonly initialParty = input<InteractionParty>('provider');
  readonly suppliers = input<DirectorySupplier[]>([]);
  readonly openWaits = input<OpenWait[]>([]);
  /** Personas del equipo a las que se puede asignar la tarea de seguimiento. */
  readonly assignees = input<{ id: string; name: string }[]>([]);
  /** Hitos del recorrido de la incidencia: una tarea siempre pertenece a uno. */
  readonly milestones = input<{ ref: string; label: string }[]>([]);
  readonly priorities = [
    { key: 'URGENTE', label: 'Urgente' },
    { key: 'ALTA', label: 'Alta' },
    { key: 'MEDIA', label: 'Media' },
    { key: 'BAJA', label: 'Baja' },
  ] as const;
  /** Hay una persona con cuenta a la que avisar (quien reportó la incidencia). */
  readonly canInformRequester = input(false);
  /** Siniestros de la incidencia: con «Seguro» o «Propietario» se pueden abrir, actualizar o cerrar desde aquí. */
  readonly claims = input<InsuranceClaimView[]>([]);
  /** Ya hay un profesional asignado a la incidencia: la visita se programa para él (si no, es de la contraparte). */
  readonly hasAssignedProfessional = input(false);
  /** Se abre para dar de alta el primer siniestro: la casilla ya viene marcada. */
  readonly presetOpenClaim = input(false);
  /** Campos ya rellenos al abrir (p. ej. desde un hito del recorrido). */
  readonly preset = input<Partial<InteractionForm>>({});
  readonly busy = input(false);
  readonly error = input('');

  readonly submitted = output<RegisterInteractionBody>();
  readonly closed = output<void>();

  readonly media = INTERACTION_MEDIA;
  readonly parties = INTERACTION_PARTIES;
  readonly waitDays = WAIT_DAY_CHOICES;
  readonly nextSteps = NEXT_STEPS;
  readonly routes = RESOLUTION_ROUTES;
  readonly routeLabels = ROUTE_LABEL;

  readonly form = signal<InteractionForm>(emptyInteractionForm());
  readonly problems = signal<string[]>([]);
  /** Casillas con un campo detrás: se marcan antes de rellenar el campo, así que no se pueden deducir del formulario. */
  /** Estado del texto exacto del aviso al solicitante (si se marcó). */
  readonly noticeState = signal<PreviewState>('idle');
  /** Lo que determina el texto del aviso, para pedírselo al servidor. */
  readonly noticeWhen = computed(() => {
    const at = this.form().visitAt ? new Date(this.form().visitAt as string) : null;
    return at && Number.isFinite(at.getTime()) ? at.toISOString() : null;
  });
  readonly noticeLabel = computed(() => {
    const t = this.form().informTemplate;
    return t === 'third_party_contacted' || t === 'waiting_third_party' ? displayPartyName(this.form()) : null;
  });
  readonly followOn = signal(false);

  readonly claimStatuses = CLAIM_STATUSES;
  readonly claimStatusLabels = CLAIM_STATUS_LABEL;
  /** Siniestros abiertos: los únicos a los que se puede referir una gestión nueva. */
  readonly liveClaims = computed(() => this.claims().filter(isLiveClaim));
  /** El siniestro solo se gestiona con el seguro o con el propietario (que tramita el suyo). */
  readonly claimParty = computed(() => this.form().party === 'insurer' || this.form().party === 'owner');
  /** Profesionales que pueden enviar una aseguradora: los proveedores del directorio que no son aseguradoras. */
  readonly professionals = computed(() => this.suppliers().filter((s) => supplierCategoryFor(s.category).key !== 'seguros'));

  ngOnInit(): void {
    const form = { ...emptyInteractionForm(this.initialParty()), openClaim: this.presetOpenClaim(), ...this.preset() };
    // Un hito que abre el diálogo ya sabe cómo sigue: espera, visita o tarea.
    if (!form.nextStep) form.nextStep = form.waitForReply ? 'wait' : form.visitAt ? 'visit' : form.followUpNote ? 'task' : null;
    this.followOn.set(form.nextStep === 'task');
    this.form.set(form);
  }

  /** «¿Qué pasa ahora?»: elegir una opción prepara solo sus campos y quita los de las demás. */
  setNextStep(choice: NextStepChoice): void {
    this.followOn.set(choice === 'task');
    this.patch({
      nextStep: choice,
      waitForReply: choice === 'wait',
      waitDays: choice === 'wait' ? this.form().waitDays : null,
      visitAt: choice === 'visit' ? (this.form().visitAt ?? this.defaultMoment()) : null,
      followUpNote: choice === 'task' ? this.form().followUpNote : '',
      followUpMilestone: choice === 'task' ? this.form().followUpMilestone : '',
      followUpAssigneeId: choice === 'task' ? this.form().followUpAssigneeId : '',
      followUpPriority: choice === 'task' ? this.form().followUpPriority : '',
      followUpAt: choice === 'task' ? (this.form().followUpAt ?? this.defaultMoment()) : null,
      newRoute: choice === 'route' ? this.form().newRoute : null,
      routeReason: choice === 'route' ? this.form().routeReason : '',
      ...(choice !== 'visit' && this.form().informTemplate === 'visit_scheduled' ? { informTemplate: null } : {}),
    });
  }

  setNewRoute(value: string): void {
    this.patch({ newRoute: (RESOLUTION_ROUTES as readonly string[]).includes(value) ? value : null });
  }

  patch(change: Partial<InteractionForm>): void {
    this.form.update((f) => ({ ...f, ...change }));
    if (this.problems().length) this.problems.set([]);
  }

  /** Proveedores del directorio que encajan con la contraparte: aseguradoras para «Seguro», el resto para «Proveedor». */
  readonly directory = computed(() => {
    const party = this.form().party;
    if (party !== 'provider' && party !== 'insurer') return [];
    return this.suppliers().filter((s) => (supplierCategoryFor(s.category).key === 'seguros') === (party === 'insurer'));
  });
  readonly usesDirectory = computed(() => this.form().party === 'provider' || this.form().party === 'insurer');

  /** Esperas abiertas de esta contraparte: se pueden cerrar si ya ha respondido. */
  readonly waitsOfParty = computed(() => this.openWaits().filter((w) => w.party === this.form().party));

  /** Plantillas del aviso al solicitante que tienen sentido con lo marcado. */
  readonly templates = computed(() =>
    [...REQUESTER_TEMPLATES.filter((t) => t.key !== 'visit_scheduled' || !!this.form().visitAt).filter((t) => t.key !== 'issue_resolved'), CUSTOM_NOTICE],
  );
  readonly customMax = CUSTOM_NOTICE_MAX;
  readonly isCustomNotice = computed(() => this.form().informTemplate === 'custom');

  setParty(party: InteractionParty): void {
    this.patch({
      party, supplierId: null, supplierName: null, closeWaitId: null, waitForReply: false, informTemplate: null,
      openClaim: false, claimInsurerName: '', claimPolicy: '', claimId: null, claimStatus: null,
      assignPro: false, assignProSupplierId: null, assignProName: '', assignProPhone: '',
    });
  }

  setClaimStatus(value: string): void {
    this.patch({ claimStatus: isClaimStatus(value) ? (value as ClaimStatus) : null });
  }

  setClaimId(value: string): void {
    this.patch({ claimId: this.liveClaims().some((c) => c.id === value) ? value : null });
  }

  /** Abrir un siniestro nuevo y cambiar el estado de uno existente son cosas distintas: se elige una. */
  setOpenClaim(on: boolean): void {
    this.patch({ openClaim: on, ...(on ? { claimStatus: null, claimId: null } : {}) });
  }

  setAssignPro(on: boolean): void {
    this.patch(on ? { assignPro: true } : { assignPro: false, assignProSupplierId: null, assignProName: '', assignProPhone: '' });
  }

  setAssignSupplier(id: string): void {
    this.patch({ assignProSupplierId: id || null, ...(id ? { assignProName: '', assignProPhone: '' } : {}) });
  }

  setSupplier(id: string): void {
    const supplier = this.suppliers().find((s) => s.id === id) ?? null;
    this.patch({ supplierId: supplier?.id ?? null, supplierName: supplier?.name ?? null, ...(supplier ? { partyLabel: '' } : {}) });
  }

  setWaitDays(value: string): void {
    const days = Number(value);
    this.patch({ waitDays: days > 0 ? days : null });
  }

  /** Lo que se deriva de la gestión, en un desplegable de selección múltiple; cada opción marcada abre sus campos debajo. */
  readonly consequenceItems = computed<DropdownItem[]>(() => [
    ...(this.waitsOfParty().length > 0 ? [{ id: 'closeWait', label: 'Ya ha respondido: cerrar la espera abierta' }] : []),
    ...(this.canInformRequester() ? [{ id: 'inform', label: 'Informar a quien reportó la incidencia' }] : []),
  ]);
  readonly consequenceSelected = computed(() => {
    const f = this.form();
    return [...(f.closeWaitId ? ['closeWait'] : []), ...(f.informTemplate ? ['inform'] : [])];
  });
  readonly consequenceSummary = computed(() => {
    const ids = this.consequenceSelected();
    if (ids.length === 0) return 'Nada más';
    const names = ids.map((id) => this.consequenceItems().find((i) => i.id === id)?.label).filter(Boolean);
    return names.length === 1 ? (names[0] as string) : `${ids.length} acciones marcadas`;
  });

  toggleConsequence(id: string): void {
    const on = !this.consequenceSelected().includes(id);
    if (id === 'closeWait') this.toggleCloseWait(on);
    else if (id === 'inform') this.toggleInform(on);
  }

  toggleCloseWait(on: boolean): void {
    this.patch({ closeWaitId: on ? (this.waitsOfParty()[0]?.id ?? null) : null });
  }

  /** Al marcar «informar», se propone el mensaje que encaja con lo marcado: la visita o el estado de la espera. */
  toggleInform(on: boolean): void {
    const f = this.form();
    const wanted: RequesterTemplate = f.visitAt ? 'visit_scheduled' : f.waitForReply ? 'waiting_third_party' : 'third_party_contacted';
    const available = this.templates().some((t) => t.key === wanted) ? wanted : (this.templates()[0]?.key ?? null);
    this.patch({ informTemplate: on ? available : null });
  }

  setTemplate(value: string): void {
    this.patch({ informTemplate: value === CUSTOM_NOTICE.key || REQUESTER_TEMPLATES.some((t) => t.key === value) ? (value as RequesterTemplate) : null });
  }

  /** Mañana a las 10:00, en el formato de `datetime-local`: la fecha que se propone para la visita y para el recordatorio. */
  private defaultMoment(): string {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(10, 0, 0, 0);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  submit(): void {
    const built: BuiltInteraction = buildInteraction(this.form(), new Date(), {
      liveClaims: this.liveClaims().length,
      hasAssignedProfessional: this.hasAssignedProfessional(),
    });
    const missing: string[] = [];
    if (!this.form().nextStep) missing.push('Indica qué pasa ahora: cada gestión tiene que dejar un siguiente paso.');
    if (this.form().informTemplate && this.noticeState() !== 'ready') missing.push('Espera a ver el texto del aviso al solicitante antes de registrar.');
    if (!built.ok || !built.body || missing.length) {
      this.problems.set([...built.errors, ...missing]);
      return;
    }
    this.problems.set([]);
    this.submitted.emit(built.body);
  }
}
