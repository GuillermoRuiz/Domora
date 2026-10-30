/* eslint-disable @typescript-eslint/no-explicit-any */
import { AiQueueService } from './ai-queue.service';
describe('Durable lease and retry semantics', () => {
  it('cannot persist after losing its fencing token', async () => {
    const tx: any = {
      aiJob: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    const db: any = { $transaction: (fn: any) => fn(tx) };
    const queue = new AiQueueService(db);
    const persist = jest.fn();
    await expect(
      queue.fenced({ id: 'j', leaseToken: 'old' } as any, persist),
    ).rejects.toThrow('AI_LEASE_LOST');
    expect(persist).not.toHaveBeenCalled();
  });
  it('does not claim a concurrently claimed job', async () => {
    const db: any = {
      aiJob: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'j',
          status: 'pending',
          leaseToken: null,
          attempts: 0,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    expect(await new AiQueueService(db).claim()).toBeNull();
  });
  it('limits what a worker claims to the configured job kinds (local-preview only runs the incident workflow)', async () => {
    const db: any = { aiJob: { findFirst: jest.fn().mockResolvedValue(null) } };
    const queue = new AiQueueService(db);
    await queue.claim(['incident', 'send']);
    expect(db.aiJob.findFirst.mock.calls[0][0].where.kind).toEqual({
      in: ['incident', 'send'],
    });
    await queue.claim();
    expect(db.aiJob.findFirst.mock.calls[1][0].where).not.toHaveProperty(
      'kind',
    );
  });
  it('a permanent error fails the job at once instead of burning the retries; a transient one goes back to pending', async () => {
    const db: any = {
      aiJob: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const queue = new AiQueueService(db);
    const job = { id: 'j', attempts: 1, leaseToken: 'token' } as any;
    await queue.finish(job, new Error('AI_REFUSAL'), { permanent: true });
    expect(db.aiJob.updateMany.mock.calls[0][0].data.status).toBe('failed');
    await queue.finish(job, new Error('OPENAI_HTTP_500'), { permanent: false });
    expect(db.aiJob.updateMany.mock.calls[1][0].data.status).toBe('pending');
    await queue.finish(job, new Error('OPENAI_HTTP_500'));
    expect(db.aiJob.updateMany.mock.calls[2][0].data.status).toBe('pending');
  });
  it('reschedules failures with a finite attempt cap and sanitized error', async () => {
    const db: any = {
      aiJob: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    await new AiQueueService(db).finish(
      { id: 'j', attempts: 5, leaseToken: 'token' } as any,
      new Error('contains private data'),
    );
    expect(db.aiJob.updateMany.mock.calls[0][0].data.status).toBe('failed');
    expect(db.aiJob.updateMany.mock.calls[0][0].data.lastError).toBe(
      'AI_PROCESSING_FAILED',
    );
  });
  it('upserts duplicate executions without resetting a completed job', async () => {
    const db: any = {
      aiJob: { upsert: jest.fn().mockResolvedValue({ status: 'completed' }) },
    };
    await new AiQueueService(db).enqueue('e1', 'incident', 'i1');
    expect(db.aiJob.upsert.mock.calls[0][0].update).toEqual({});
  });
});
