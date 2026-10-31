import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { saveBlob } from '../../core/file-download';
import { MeetingsService } from '../../core/meetings.service';
import type { Meeting, MeetingStatus } from '../../core/models';
import { bindOwnerScopeToRoute } from '../../core/owner-scope-route';
import { OwnerScopeService, type ScopeProperty } from '../../core/owner-scope.service';
import { StateService } from '../../core/state.service';
import { TopbarComponent } from '../../layout/topbar/topbar.component';
import { EmptyStateComponent } from '../../shared/components/empty-state/empty-state.component';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { CommunityScopeSelectorComponent } from '../community-c/community-scope-selector/community-scope-selector.component';
import { JuntasDataCache } from './juntas-data-cache';
import { JuntasSectionComponent } from './juntas-section/juntas-section.component';

/** Una propiedad con comunidad: sus juntas (el voto y la delegación son de la propiedad). */
interface JuntasBlock {
  property: ScopeProperty;
  estateId: string;
}

const STATUS_LABEL: Record<MeetingStatus, string> = {
  convocada: 'Convocada',
  celebrada: 'Celebrada',
  cancelada: 'Cancelada',
  firmada: 'Acta firmada',
};

/**
 * «Juntas» del propietario (rol C): las juntas convocadas en las que puede votar o delegar y las actas que
 * esperan su firma, por cada propiedad del ámbito de la cabecera (en «Todas», un bloque por propiedad).
 * `?propertyId=` elige esa propiedad, `?estateId=` la primera de esa comunidad y `?meeting=<id>` destaca esa junta
 * (avisos y enlaces antiguos a la pestaña «Juntas» de la ficha): arriba, con su estado, aunque ya no admita votos
 * (una junta celebrada o cancelada).
 */
@Component({
  selector: 'app-juntas-c',
  standalone: true,
  imports: [TopbarComponent, CommunityScopeSelectorComponent, EmptyStateComponent, IconComponent, JuntasSectionComponent],
  providers: [JuntasDataCache],
  templateUrl: './juntas-c.component.html',
  styleUrl: './juntas-c.component.scss',
})
export class JuntasCComponent {
  readonly scope = inject(OwnerScopeService);
  private state = inject(StateService);
  private cache = inject(JuntasDataCache);
  private meetings = inject(MeetingsService);

  readonly highlightedMeetingId = signal<string | null>(null);
  /** La junta del enlace, buscada entre las de las comunidades del ámbito; null si no está (o aún no se sabe). */
  readonly highlightedMeeting = signal<Meeting | null>(null);
  readonly actaError = signal<string | null>(null);
  readonly statusLabel = STATUS_LABEL;

  readonly blocks = computed<JuntasBlock[]>(() => {
    const properties = this.scope.isAll() ? this.scope.items() : [this.scope.selected()].filter((p): p is ScopeProperty => !!p);
    return properties.flatMap((property) => (property.estateId ? [{ property, estateId: property.estateId }] : []));
  });
  readonly scopeName = computed(() => (this.scope.isAll() ? 'Todas mis propiedades' : this.scope.selected()?.nickname ?? ''));

  constructor() {
    bindOwnerScopeToRoute(['propertyId', 'estateId'], (params) => this.highlightedMeetingId.set(params.get('meeting')));
    effect(() => {
      const meetingId = this.highlightedMeetingId();
      const estateIds = [...new Set(this.blocks().map((b) => b.estateId))];
      untracked(() => void this.findHighlighted(meetingId, estateIds));
    });
  }

  private async findHighlighted(meetingId: string | null, estateIds: string[]): Promise<void> {
    if (!meetingId) return this.highlightedMeeting.set(null);
    try {
      const lists = await Promise.all(estateIds.map((id) => this.cache.meetings(id)));
      if (this.highlightedMeetingId() !== meetingId) return;
      this.highlightedMeeting.set(lists.flat().find((m) => m.id === meetingId) ?? null);
    } catch (error) {
      console.error('Error buscando la junta del aviso', error);
      this.highlightedMeeting.set(null);
    }
  }

  /** El acta firmada de la junta destacada. */
  async downloadActa(meeting: Meeting): Promise<void> {
    this.actaError.set(null);
    try {
      await saveBlob(await this.meetings.downloadActa(meeting.id), `Acta · ${meeting.title}`);
    } catch (error) {
      console.error('Error descargando el acta', error);
      this.actaError.set('No se pudo descargar el acta. Inténtalo de nuevo.');
    }
  }

  dateLabel(iso: string): string {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  openAddProperty(): void {
    this.state.showAddPropertyModal.set(true);
  }
}
