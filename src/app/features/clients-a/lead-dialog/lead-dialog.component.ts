import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { LeadsService } from '../../../core/leads.service';
import type { CommercialFollowUp, LeadDetail, LeadInput, LeadOrigin, LeadStatus, PlanTier } from '../../../core/models';
import { BtnComponent } from '../../../shared/components/btn/btn.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { BadgeComponent } from '../../../shared/components/badge/badge.component';
import { LEAD_ORIGIN_LABEL, LEAD_STATUS_LABEL, fmtDay, leadStatusVariant } from '../clients-a-table';

type ManualOrigin = Exclude<LeadOrigin, 'solicitud_alta'>;
type EditableStatus = Exclude<LeadStatus, 'convertido'>;

const MANUAL_ORIGINS: ManualOrigin[] = ['web', 'referido', 'comercial'];
const EDITABLE_STATUSES: EditableStatus[] = ['nuevo', 'contactado', 'en_prueba', 'descartado'];
const PLANS: PlanTier[] = ['BASE', 'STANDARD', 'PREMIUM'];

function messageFrom(error: unknown, fallback: string): string {
  const msg = (error as { error?: { message?: unknown } })?.error?.message;
  if (typeof msg === 'string') return msg;
  if (Array.isArray(msg) && typeof msg[0] === 'string') return msg[0];
  return fallback;
}

/**
 * Potential client (S13): data, «seguimiento comercial» and «Convertir en
 * cliente», which creates the despacho through the same path as «Añadir
 * administrador». `leadId` null = «Nuevo cliente».
 */
@Component({
  selector: 'app-lead-dialog',
  standalone: true,
  imports: [BtnComponent, IconComponent, BadgeComponent],
  templateUrl: './lead-dialog.component.html',
  styleUrl: './lead-dialog.component.scss',
})
export class LeadDialogComponent implements OnInit {
  private leadsSvc = inject(LeadsService);

  readonly leadId = input<string | null>(null);
  readonly closed = output<void>();
  readonly saved = output<void>();
  readonly converted = output<{ administratorId: string; name: string }>();
  readonly openClient = output<string>();

  readonly manualOrigins = MANUAL_ORIGINS;
  readonly editableStatuses = EDITABLE_STATUSES;
  readonly plans = PLANS;
  readonly originLabel = LEAD_ORIGIN_LABEL;
  readonly statusLabel = LEAD_STATUS_LABEL;
  readonly statusVariant = leadStatusVariant;
  readonly fmtDay = fmtDay;

  lead = signal<LeadDetail | null>(null);
  loading = signal(false);
  error = signal<string | null>(null);
  saving = signal(false);

  name = signal('');
  contactName = signal('');
  contactEmail = signal('');
  contactPhone = signal('');
  city = signal('');
  origin = signal<LeadOrigin>('comercial');
  planOfInterest = signal<PlanTier | ''>('');
  status = signal<EditableStatus>('nuevo');
  nextAction = signal('');
  nextActionAt = signal('');
  notes = signal('');

  followUps = signal<CommercialFollowUp[]>([]);
  followUpText = signal('');
  addingFollowUp = signal(false);

  converting = signal(false);
  convertCif = signal('');
  convertName = signal('');
  convertPlan = signal<PlanTier | ''>('');
  convertError = signal<string | null>(null);

  isNew = computed(() => this.leadId() === null);
  isConverted = computed(() => this.lead()?.status === 'convertido');
  fromRequest = computed(() => this.lead()?.origin === 'solicitud_alta');
  canSave = computed(() => this.name().trim().length > 0 && !this.saving() && !this.isConverted());
  canConvert = computed(() => this.convertCif().trim().length > 0 && !!this.convertPlan() && !this.saving());

  async ngOnInit(): Promise<void> {
    const id = this.leadId();
    if (!id) return;
    this.loading.set(true);
    try {
      const lead = await this.leadsSvc.getLead(id);
      this.lead.set(lead);
      this.fill(lead);
    } catch (error) {
      this.error.set(messageFrom(error, 'No se pudo cargar la oportunidad.'));
    } finally {
      this.loading.set(false);
    }
  }

  private fill(lead: LeadDetail): void {
    this.name.set(lead.name);
    this.contactName.set(lead.contactName ?? '');
    this.contactEmail.set(lead.contactEmail ?? '');
    this.contactPhone.set(lead.contactPhone ?? '');
    this.city.set(lead.city ?? '');
    this.origin.set(lead.origin);
    this.planOfInterest.set(lead.planOfInterest ?? '');
    if (lead.status !== 'convertido') this.status.set(lead.status);
    this.nextAction.set(lead.nextAction ?? '');
    this.nextActionAt.set(lead.nextActionAt ?? '');
    this.notes.set(lead.notes ?? '');
    this.followUps.set(lead.followUps);
  }

  private input(): LeadInput {
    const orNull = (v: string) => (v.trim() ? v.trim() : null);
    return {
      name: this.name().trim(),
      contactName: orNull(this.contactName()),
      contactEmail: orNull(this.contactEmail()),
      contactPhone: orNull(this.contactPhone()),
      city: orNull(this.city()),
      planOfInterest: this.planOfInterest() || null,
      nextAction: orNull(this.nextAction()),
      nextActionAt: this.nextActionAt() || null,
      notes: orNull(this.notes()),
    };
  }

  async save(): Promise<void> {
    if (!this.canSave()) return;
    this.saving.set(true);
    this.error.set(null);
    try {
      const id = this.leadId();
      if (id === null) {
        await this.leadsSvc.createLead({ ...this.input(), name: this.name().trim(), origin: this.origin() as ManualOrigin, status: this.status() });
      } else {
        await this.leadsSvc.updateLead(id, {
          ...this.input(),
          status: this.status(),
          ...(this.fromRequest() ? {} : { origin: this.origin() as ManualOrigin }),
        });
      }
      this.saved.emit();
    } catch (error) {
      this.error.set(messageFrom(error, 'No se pudo guardar la oportunidad.'));
    } finally {
      this.saving.set(false);
    }
  }

  async addFollowUp(): Promise<void> {
    const id = this.leadId();
    const text = this.followUpText().trim();
    if (!id || !text) return;
    this.addingFollowUp.set(true);
    this.error.set(null);
    try {
      const entry = await this.leadsSvc.addLeadFollowUp(id, text);
      this.followUps.set([entry, ...this.followUps()]);
      this.followUpText.set('');
    } catch (error) {
      this.error.set(messageFrom(error, 'No se pudo añadir el seguimiento.'));
    } finally {
      this.addingFollowUp.set(false);
    }
  }

  startConvert(): void {
    this.convertName.set(this.name().trim());
    this.convertPlan.set(this.planOfInterest());
    this.convertCif.set('');
    this.convertError.set(null);
    this.converting.set(true);
  }

  async convert(): Promise<void> {
    const id = this.leadId();
    const lead = this.lead();
    if (!id || !lead || !this.canConvert()) return;
    this.saving.set(true);
    this.convertError.set(null);
    const name = this.convertName().trim();
    try {
      const { administratorId } = await this.leadsSvc.convertLead(id, {
        cif: this.convertCif().trim(),
        plan: this.convertPlan() as PlanTier,
        ...(name && name !== lead.name ? { name } : {}),
      });
      this.converted.emit({ administratorId, name: name || lead.name });
    } catch (error) {
      this.convertError.set(messageFrom(error, 'No se pudo convertir en cliente.'));
    } finally {
      this.saving.set(false);
    }
  }
}
