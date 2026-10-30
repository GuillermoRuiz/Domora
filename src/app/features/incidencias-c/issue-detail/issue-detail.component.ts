import { Component, ElementRef, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { saveBlob } from '../../../core/file-download';
import {
  OWNER_ISSUE_FINAL_STATUSES,
  OWNER_ISSUE_STATUS,
  OWNER_ISSUE_SUBTYPES,
  type OwnerIssueDetail,
  type OwnerIssueStatus,
} from '../../../core/owner-issues.models';
import { OwnerIssuesService } from '../../../core/owner-issues.service';
import { AttachmentGalleryComponent, type GalleryAttachment } from '../../../shared/components/attachment-gallery/attachment-gallery.component';
import { ConfirmDialogService } from '../../../shared/components/confirm-dialog/confirm-dialog.service';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { IssueTimelineComponent, type TimelinePending } from '../../../shared/components/issue-timeline/issue-timeline.component';
import { StatusPillComponent } from '../../../shared/components/status-pill/status-pill.component';
import { checkAttachments, madridDay, messageFrom, responseTime } from '../issue-helpers';

const PENDING: TimelinePending = { title: 'Pendiente de actualización', text: 'Te notificaremos cualquier novedad' };

/**
 * Ficha de una incidencia de la comunidad para el propietario: descripción, estado, adjuntos y seguimiento cronológico,
 * más lo que puede hacer en cada momento (responder, añadir archivos, retirar, reabrir, valorar, «Me afecta también»).
 * Solo quien la reportó actúa; el resto de vecinos la ve y puede marcar que le afecta. Se carga sola desde `issueId` y
 * avisa con `changed` tras cada acción para que la página refresque el listado.
 */
@Component({
  selector: 'app-issue-detail',
  standalone: true,
  imports: [StatusPillComponent, IconComponent, IssueTimelineComponent, AttachmentGalleryComponent],
  templateUrl: './issue-detail.component.html',
  styleUrl: './issue-detail.component.scss',
})
export class IssueDetailComponent {
  readonly issueId = input.required<string>();
  readonly closed = output<void>();
  readonly changed = output<void>();

  private api = inject(OwnerIssuesService);
  private confirmDialog = inject(ConfirmDialogService);
  private heading = viewChild<ElementRef<HTMLElement>>('heading');

  readonly detail = signal<OwnerIssueDetail | null>(null);
  readonly loadFailed = signal(false);
  readonly busy = signal(false);
  readonly actionError = signal<string | null>(null);
  readonly attachmentError = signal<string | null>(null);
  readonly replyText = signal('');
  readonly stars = signal(0);
  readonly ratingComment = signal('');
  readonly starOptions = [1, 2, 3, 4, 5];
  private loadSeq = 0;

  readonly status = computed(() => {
    const d = this.detail();
    return d ? OWNER_ISSUE_STATUS[d.status] ?? { label: d.status, tone: 'neutral' as const } : null;
  });
  readonly typeLabel = computed(() => {
    const d = this.detail();
    return d ? OWNER_ISSUE_SUBTYPES.find((s) => s.value === d.type)?.label ?? d.type : '';
  });
  readonly isFinal = computed(() => !!this.detail() && OWNER_ISSUE_FINAL_STATUSES.includes(this.detail()!.status));
  readonly pending = computed(() => (this.isFinal() ? null : PENDING));
  readonly expected = computed(() => (this.detail() && !this.isFinal() ? responseTime(this.detail()!.expectedResponseHours) : null));
  readonly createdOn = computed(() => (this.detail() ? madridDay(this.detail()!.createdAt) : ''));
  readonly statusLabel = (status: string) => OWNER_ISSUE_STATUS[status as OwnerIssueStatus]?.label ?? status;
  readonly loader = (a: GalleryAttachment) => this.api.downloadAttachment(this.issueId(), a.id);

  constructor() {
    effect(() => {
      const id = this.issueId();
      untracked(() => void this.load(id));
    });
  }

  affectedText(count: number): string {
    return count === 1 ? '1 vecino afectado' : `${count} vecinos afectados`;
  }

  close(): void {
    this.closed.emit();
  }

  async reply(): Promise<void> {
    const text = this.replyText().trim();
    if (!text) return;
    if (await this.run(() => this.api.reply(this.issueId(), text))) this.replyText.set('');
  }

  async withdraw(): Promise<void> {
    const confirmed = await this.confirmDialog.ask({
      title: 'Retirar',
      message: 'La incidencia se cerrará y el administrador dejará de tramitarla. ¿Quieres retirarla?',
      confirmLabel: 'Retirar',
      tone: 'danger',
    });
    if (confirmed) await this.run(() => this.api.withdraw(this.issueId()));
  }

  async reopen(): Promise<void> {
    await this.run(() => this.api.reopen(this.issueId()));
  }

  async rate(): Promise<void> {
    if (!this.stars()) return;
    await this.run(() => this.api.rate(this.issueId(), this.stars(), this.ratingComment()));
  }

  async toggleAffected(): Promise<void> {
    const d = this.detail();
    if (!d) return;
    await this.run(() => this.api.setAffected(d.id, !d.affectedByMe));
  }

  async addFiles(files: File[]): Promise<void> {
    const { valid, errors } = checkAttachments(files);
    this.actionError.set(null);
    this.busy.set(true);
    let uploaded = 0;
    try {
      for (const file of valid) {
        try {
          await this.api.uploadAttachment(this.issueId(), file);
          uploaded++;
        } catch (error) {
          errors.push(messageFrom(error, `No se pudo subir «${file.name}».`));
        }
      }
      this.attachmentError.set(errors.length ? errors.join(' ') : null);
      if (uploaded > 0) {
        await this.refresh();
        this.changed.emit();
      }
    } finally {
      this.busy.set(false);
    }
  }

  async download(attachment: GalleryAttachment): Promise<void> {
    this.actionError.set(null);
    try {
      await saveBlob(await this.loader(attachment), attachment.fileName ?? 'Adjunto');
    } catch (error) {
      this.actionError.set(messageFrom(error, 'No se pudo descargar el archivo. Inténtalo de nuevo.'));
    }
  }

  private async load(id: string): Promise<void> {
    this.detail.set(null);
    this.loadFailed.set(false);
    this.actionError.set(null);
    this.attachmentError.set(null);
    this.replyText.set('');
    this.stars.set(0);
    this.ratingComment.set('');
    const seq = ++this.loadSeq;
    try {
      const detail = await this.api.detail(id);
      if (seq !== this.loadSeq) return;
      this.detail.set(detail);
      setTimeout(() => this.heading()?.nativeElement.focus());
    } catch {
      if (seq === this.loadSeq) this.loadFailed.set(true);
    }
  }

  private async refresh(): Promise<void> {
    const seq = ++this.loadSeq;
    try {
      const detail = await this.api.detail(this.issueId());
      if (seq === this.loadSeq) this.detail.set(detail);
    } catch {
      // Keeps the previous detail; the list refresh still happens.
    }
  }

  /** Runs an action that answers with the updated detail. */
  private async run(action: () => Promise<OwnerIssueDetail>): Promise<boolean> {
    this.actionError.set(null);
    this.busy.set(true);
    try {
      const detail = await action();
      this.loadSeq++;
      this.detail.set(detail);
      this.changed.emit();
      return true;
    } catch (error) {
      this.actionError.set(messageFrom(error, 'No se pudo completar la acción. Inténtalo de nuevo.'));
      return false;
    } finally {
      this.busy.set(false);
    }
  }
}
