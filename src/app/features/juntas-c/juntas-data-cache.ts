import { Injectable, inject } from '@angular/core';
import { MeetingsService } from '../../core/meetings.service';
import { MeetingVoteDelegationsService } from '../../core/meeting-vote-delegations.service';
import { VoteSessionsService } from '../../core/vote-sessions.service';
import type { ActaSigning } from '../../core/acta.models';
import type { Meeting, MeetingVoteDelegation, VoteSession } from '../../core/models';

/**
 * Lecturas de juntas que no dependen de la propiedad, compartidas por todos los bloques de la página «Juntas»
 * (en «Todas», varias propiedades de una misma comunidad piden lo mismo). Se provee en `JuntasCComponent`; sin
 * ella, `JuntasSectionComponent` lee directamente. Tras cualquier cambio (voto, delegación) se invalida entera.
 * Una lectura fallida no se guarda, para que se pueda reintentar.
 */
@Injectable()
export class JuntasDataCache {
  private readonly meetingsSvc = inject(MeetingsService);
  private readonly delegationsSvc = inject(MeetingVoteDelegationsService);
  private readonly voteSessionsSvc = inject(VoteSessionsService);
  private readonly store = new Map<string, Promise<unknown>>();

  meetings(estateId: string): Promise<Meeting[]> {
    return this.memo(`meetings:${estateId}`, () => this.meetingsSvc.listMeetingsByEstate(estateId));
  }

  delegations(meetingId: string): Promise<MeetingVoteDelegation[]> {
    return this.memo(`delegations:${meetingId}`, () => this.delegationsSvc.list(meetingId));
  }

  voteSessions(meetingId: string): Promise<VoteSession[]> {
    return this.memo(`votes:${meetingId}`, () => this.voteSessionsSvc.list(meetingId));
  }

  actaSigning(meetingId: string): Promise<ActaSigning> {
    return this.memo(`signing:${meetingId}`, () => this.meetingsSvc.getActaSigning(meetingId));
  }

  invalidate(): void {
    this.store.clear();
  }

  private memo<T>(key: string, load: () => Promise<T>): Promise<T> {
    const cached = this.store.get(key) as Promise<T> | undefined;
    if (cached) return cached;
    const promise = load();
    this.store.set(key, promise);
    promise.catch(() => {
      if (this.store.get(key) === promise) this.store.delete(key);
    });
    return promise;
  }
}
