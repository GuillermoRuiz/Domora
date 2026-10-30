import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Injector,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BtnComponent } from '../../../../shared/components/btn/btn.component';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import { ConfirmDialogService } from '../../../../shared/components/confirm-dialog/confirm-dialog.service';
import { SelectDropdownDirective } from '../../../../shared/components/dropdown/select-dropdown.directive';
import type { ActaDocumentModel, ActaValidationIssue, ActaVersionSummary, ActaVersionView, SaveActaEditsPayload } from '../../../../core/acta.models';
import {
  A4_HEIGHT_PX,
  A4_WIDTH_PX,
  PAGE_INNER_HEIGHT,
  REPEATED_TABLE_HEADER,
  editKeyId,
  layoutBlocks,
  paginate,
  sameEditKey,
  type ActaBlock,
  type ActaEditKey,
} from './acta-layout';

/** Cambios de texto hechos en el visor que todavía no se han guardado como versión. */
interface PendingEdits {
  introduction?: string;
  observations?: string;
  nextSteps?: string;
  items: Record<string, string>;
}

const MISSING_LABEL: Record<string, string> = {
  actualStartAt: 'la hora real de inicio',
  actualEndAt: 'la hora real de fin',
};

/** Lo que dice el modelo para un texto editable. */
function originalText(model: ActaDocumentModel, key: ActaEditKey): string {
  switch (key.kind) {
    case 'introduction':
      return model.constitution.introduction.text;
    case 'observations':
      return model.observations.text;
    case 'nextSteps':
      return model.nextSteps.text;
    case 'item':
      return model.items.find((item) => item.id === key.id)?.narrative.text ?? '';
  }
}

function cleanText(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

/** Pone en el documento los textos editados sin guardar (solo texto: lo factual no se toca). */
function withPending(model: ActaDocumentModel, pending: PendingEdits): ActaDocumentModel {
  return {
    ...model,
    constitution: pending.introduction === undefined ? model.constitution : { ...model.constitution, introduction: { ...model.constitution.introduction, text: pending.introduction } },
    observations: pending.observations === undefined ? model.observations : { ...model.observations, text: pending.observations },
    nextSteps: pending.nextSteps === undefined ? model.nextSteps : { ...model.nextSteps, text: pending.nextSteps },
    items: model.items.map((item) => (pending.items[item.id] === undefined ? item : { ...item, narrative: { ...item.narrative, text: pending.items[item.id] } })),
  };
}

/**
 * Visor documental del acta: una página A4 blanca (o varias) sobre fondo neutro, con la barra de
 * herramientas arriba. Representa el `ActaDocumentModel` de la versión; los textos redactables
 * (párrafo inicial, desarrollo de cada punto, observaciones y actuaciones) se editan por bloques y
 * lo factual (fechas, votos, propiedades, coeficientes, resultados) sale siempre del modelo.
 */
@Component({
  selector: 'app-acta-viewer',
  standalone: true,
  imports: [NgTemplateOutlet, FormsModule, BtnComponent, IconComponent, SelectDropdownDirective],
  templateUrl: './acta-viewer.component.html',
  styleUrl: './acta-viewer.component.scss',
})
export class ActaViewerComponent implements OnChanges, AfterViewInit, OnDestroy {
  @Input({ required: true }) set version(value: ActaVersionView) {
    this.versionSignal.set(value);
  }
  get version(): ActaVersionView {
    return this.versionSignal();
  }
  /** Una llamada al servidor está en curso. */
  @Input() busy = false;
  @Input() error = '';
  /** Avisos de la validación previa (no bloquean). */
  @Input() warnings: ActaValidationIssue[] = [];
  /** Versiones del acta entre las que se puede cambiar, la más reciente primero. */
  @Input() versions: ActaVersionSummary[] = [];
  /** Se pide ver otra versión del acta (por id). */
  @Output() pickVersion = new EventEmitter<string>();
  @Output() back = new EventEmitter<void>();
  @Output() save = new EventEmitter<SaveActaEditsPayload>();
  @Output() regenerate = new EventEmitter<void>();
  /** Descargar el PDF de la versión que se está viendo (su id). */
  @Output() downloadPdf = new EventEmitter<string>();
  @Output() prepare = new EventEmitter<void>();
  /** Seguir a la firma (con la versión ya preparada). */
  @Output() continueToSign = new EventEmitter<void>();
  /** Corregir los datos de la reunión (horas y convocatoria). */
  @Output() editData = new EventEmitter<void>();

  @ViewChild('measure') private measureRef?: ElementRef<HTMLElement>;
  @ViewChild('scroller') private scrollerRef?: ElementRef<HTMLElement>;

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly doc = inject(DOCUMENT);
  private resizeObserver?: ResizeObserver;
  private readonly versionSignal = signal<ActaVersionView>(undefined as unknown as ActaVersionView);

  readonly pageWidth = A4_WIDTH_PX;
  readonly pageHeight = A4_HEIGHT_PX;
  readonly pending = signal<PendingEdits>({ items: {} });
  /** Texto que se está editando ahora y su borrador. */
  readonly editing = signal<ActaEditKey | null>(null);
  readonly draftText = signal('');
  /** Reducción de la página para que quepa en pantallas estrechas. */
  readonly scale = signal(1);

  readonly editable = computed(() => this.versionSignal()?.editable ?? false);
  readonly model = computed(() => withPending(this.versionSignal().document, this.pending()));
  readonly blocks = computed(() => layoutBlocks(this.model(), this.editable()));
  /** Índices de los bloques de cada página; mientras no se ha medido, todo en una. */
  readonly pages = signal<number[][]>([[]]);
  readonly hasChanges = computed(() => Object.keys(this.changedPayload()).length > 1);

  readonly repeatedHeader = REPEATED_TABLE_HEADER;
  readonly editKeyId = editKeyId;

  constructor() {
    // Se vuelve a repartir en páginas cada vez que cambia el contenido.
    effect(() => {
      const blocks = this.blocks();
      untracked(() => {
        this.pages.set([blocks.map((_, index) => index)]);
        afterNextRender(() => this.measure(), { injector: this.injector });
      });
    });
    this.doc.body.appendChild(this.host.nativeElement);
  }

  ngOnChanges(changes: SimpleChanges): void {
    const change = changes['version'];
    if (change && change.previousValue?.id !== change.currentValue?.id) {
      this.pending.set({ items: {} });
      this.editing.set(null);
    }
  }

  ngAfterViewInit(): void {
    const scroller = this.scrollerRef?.nativeElement;
    if (scroller && typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.fit());
      this.resizeObserver.observe(scroller);
    }
    this.fit();
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.host.nativeElement.remove();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.editing()) this.cancelEdit();
    else this.back.emit();
  }

  // ── Maquetación ──────────────────────────────────────────────────────────

  private fit(): void {
    const width = this.scrollerRef?.nativeElement.clientWidth ?? 0;
    this.scale.set(width > 0 ? Math.min(1, (width - 24) / A4_WIDTH_PX) : 1);
  }

  /** Mide cada bloque con el estilo real y los reparte en páginas A4. */
  private measure(): void {
    const container = this.measureRef?.nativeElement;
    if (!container) return;
    const elements = Array.from(container.querySelectorAll<HTMLElement>('[data-block]'));
    const blocks = this.blocks();
    if (elements.length !== blocks.length) return;
    const heights = elements.map((element) => element.getBoundingClientRect().height);
    if (heights.every((height) => height === 0)) return; // sin maquetación (p. ej. pruebas): una sola página
    this.pages.set(paginate(blocks, heights, PAGE_INNER_HEIGHT));
  }

  blockAt(index: number): ActaBlock | null {
    return index === REPEATED_TABLE_HEADER ? (this.blocks().find((block) => block.kind === 'tableHeader') ?? null) : (this.blocks()[index] ?? null);
  }

  // ── Estado y avisos ──────────────────────────────────────────────────────

  get statusLabel(): string {
    return this.versionSignal().statusLabel;
  }

  get missingNotice(): string {
    const missing = this.versionSignal().document.missing.map((entry) => MISSING_LABEL[entry] ?? entry);
    return missing.length ? `Datos que no constan y se omiten del documento: ${missing.join('; ')}.` : '';
  }

  get canPrepare(): boolean {
    const version = this.versionSignal();
    return version.status === 'draft' && version.editable && !this.hasChanges() && !this.busy;
  }

  get isReady(): boolean {
    return this.versionSignal().status === 'readyForSignature';
  }

  get hasEditedText(): boolean {
    const model = this.versionSignal().document;
    const edited = (block: { origin: string; text: string }) => block.origin === 'edited' && block.text.trim().length > 0;
    return edited(model.constitution.introduction) || edited(model.observations) || edited(model.nextSteps) || model.items.some((item) => edited(item.narrative));
  }

  // ── Edición por bloques ──────────────────────────────────────────────────

  currentText(key: ActaEditKey): string {
    const model = this.model();
    return originalText(model, key);
  }

  startEdit(key: ActaEditKey): void {
    if (!this.editable()) return;
    this.draftText.set(this.currentText(key));
    this.editing.set(key);
  }

  isEditing(block: ActaBlock): boolean {
    return !!block.edit && sameEditKey(this.editing(), block.edit.key);
  }

  applyEdit(): void {
    const key = this.editing();
    if (!key) return;
    const text = cleanText(this.draftText());
    this.pending.update((pending) => {
      const next: PendingEdits = { ...pending, items: { ...pending.items } };
      const original = originalText(this.versionSignal().document, key);
      const same = text === original;
      switch (key.kind) {
        case 'introduction':
          if (same) delete next.introduction;
          else next.introduction = text;
          break;
        case 'observations':
          if (same) delete next.observations;
          else next.observations = text;
          break;
        case 'nextSteps':
          if (same) delete next.nextSteps;
          else next.nextSteps = text;
          break;
        case 'item':
          if (same) delete next.items[key.id];
          else next.items[key.id] = text;
          break;
      }
      return next;
    });
    this.editing.set(null);
  }

  cancelEdit(): void {
    this.editing.set(null);
  }

  /** Solo lo que cambió respecto a la versión mostrada. */
  private changedPayload(): SaveActaEditsPayload {
    const pending = this.pending();
    const payload: SaveActaEditsPayload = { baseVersionId: this.versionSignal()?.id ?? '' };
    if (pending.introduction !== undefined) payload.introduction = pending.introduction;
    if (pending.observations !== undefined) payload.observations = pending.observations;
    if (pending.nextSteps !== undefined) payload.nextSteps = pending.nextSteps;
    const items = Object.entries(pending.items).map(([id, narrative]) => ({ id, narrative }));
    if (items.length) payload.items = items;
    return payload;
  }

  onSave(): void {
    if (!this.hasChanges() || this.busy) return;
    this.save.emit(this.changedPayload());
  }

  discardChanges(): void {
    this.pending.set({ items: {} });
    this.editing.set(null);
  }

  async onRegenerate(): Promise<void> {
    if (this.busy || !this.editable()) return;
    if (this.hasChanges() || this.hasEditedText) {
      const ok = await this.confirm.ask({
        title: 'Regenerar la redacción',
        message: 'Se volverá a redactar a partir de tus notas y se sustituirán las ediciones que hayas hecho a mano en los textos redactados. Los datos de la junta (asistencia, votos, resultados) no cambian.',
        confirmLabel: 'Regenerar redacción',
      });
      if (!ok) return;
      this.discardChanges();
    }
    this.regenerate.emit();
  }
}
