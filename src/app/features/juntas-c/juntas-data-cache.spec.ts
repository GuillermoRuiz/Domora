import { TestBed } from '@angular/core/testing';
import { MeetingsService } from '../../core/meetings.service';
import { MeetingVoteDelegationsService } from '../../core/meeting-vote-delegations.service';
import { VoteSessionsService } from '../../core/vote-sessions.service';
import { JuntasDataCache } from './juntas-data-cache';

describe('JuntasDataCache', () => {
  function setup(listMeetings: ReturnType<typeof vi.fn>) {
    TestBed.configureTestingModule({
      providers: [
        JuntasDataCache,
        { provide: MeetingsService, useValue: { listMeetingsByEstate: listMeetings, getActaSigning: vi.fn() } },
        { provide: MeetingVoteDelegationsService, useValue: { list: vi.fn() } },
        { provide: VoteSessionsService, useValue: { list: vi.fn() } },
      ],
    });
    return TestBed.inject(JuntasDataCache);
  }

  it('shares one request per estate until it is invalidated', async () => {
    const listMeetings = vi.fn(async () => []);
    const cache = setup(listMeetings);
    await Promise.all([cache.meetings('e1'), cache.meetings('e1'), cache.meetings('e2')]);
    expect(listMeetings).toHaveBeenCalledTimes(2);
    cache.invalidate();
    await cache.meetings('e1');
    expect(listMeetings).toHaveBeenCalledTimes(3);
  });

  it('a failed read is not kept, so the next one retries', async () => {
    const listMeetings = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue([]);
    const cache = setup(listMeetings);
    await expect(cache.meetings('e1')).rejects.toThrow('boom');
    await expect(cache.meetings('e1')).resolves.toEqual([]);
    expect(listMeetings).toHaveBeenCalledTimes(2);
  });
});
