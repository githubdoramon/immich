import { getQueueToken } from '@nestjs/bullmq';
import { ModuleRef, Reflector } from '@nestjs/core';
import type { IWebhookJob } from 'src/types.js';
import { OnJob } from 'src/decorators.js';
import { JobName, JobStatus, QueueName } from 'src/enum.js';
import { ConfigRepository } from 'src/repositories/config.repository.js';
import { EventRepository } from 'src/repositories/event.repository.js';
import { JobRepository } from 'src/repositories/job.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';

describe('JobRepository queue options', () => {
  const queue = { addBulk: vi.fn().mockResolvedValue([]), add: vi.fn().mockResolvedValue({}), getJobs: vi.fn() };
  let sut: JobRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    // Populate discovery with every job so setup enforces its normal completeness check.
    class Handlers {}
    for (const name of Object.values(JobName)) {
      const descriptor = { value: vi.fn().mockResolvedValue(JobStatus.Success) };
      OnJob({ name, queue: QueueName.BackgroundTask })(Handlers.prototype, name, descriptor);
      Object.defineProperty(Handlers.prototype, name, descriptor);
    }
    const handlers = new Handlers();
    const moduleRef = {
      get: (token: unknown) => {
        if (token === Reflector) {
          return new Reflector();
        }
        if (token === Handlers) {
          return handlers;
        }
        if (token === getQueueToken(QueueName.BackgroundTask)) {
          return queue;
        }
        throw new Error(`Unexpected provider: ${String(token)}`);
      },
    } as ModuleRef;
    const logger = { setContext: vi.fn(), verbose: vi.fn() } as unknown as LoggingRepository;
    sut = new JobRepository(moduleRef, {} as ConfigRepository, {} as EventRepository, logger);
    sut.setup([Handlers]);
  });

  it('passes webhook attempts and exponential backoff to BullMQ bulk jobs as opts', async () => {
    const data: IWebhookJob = {
      webhook: {
        id: 'people',
        url: 'http://automation/hooks',
        method: 'POST',
        headers: {},
        timeout: 1000,
        retries: 5,
        backoffMs: 3000,
      },
      eventName: 'PersonCreate',
      payload: {},
      timestamp: '2026-10-22T08:00:00Z',
      deliveryId: 'delivery',
    };
    await sut.queue({ name: JobName.WebhookDelivery, data });
    expect(queue.addBulk).toHaveBeenCalledWith([
      {
        name: JobName.WebhookDelivery,
        data,
        opts: { attempts: 5, backoff: { type: 'exponential', delay: 3000 } },
      },
    ]);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('redacts webhook secrets in queue inspection without modifying worker data', async () => {
    const data = {
      webhook: {
        id: 'people',
        url: 'https://user:url-secret@automation/hooks',
        headers: { Authorization: 'Bearer header-secret' },
      },
      payload: { password: 'payload-secret' },
      eventName: 'PersonCreate',
      timestamp: 'time',
      deliveryId: 'delivery-id',
    };
    queue.getJobs.mockResolvedValue([
      { id: '1', name: JobName.WebhookDelivery, timestamp: 1000, data },
      { id: '2', name: JobName.PersonCleanup, timestamp: 1000, data: { id: 'ordinary-data' } },
    ]);
    const jobs = await sut.searchJobs(QueueName.BackgroundTask, {});
    expect(jobs[0].data).toEqual({
      webhookId: 'people',
      eventName: 'PersonCreate',
      timestamp: 'time',
      deliveryId: 'delivery-id',
    });
    expect(jobs[1].data).toEqual({ id: 'ordinary-data' });
    for (const secret of ['url-secret', 'header-secret', 'payload-secret']) {
      expect(JSON.stringify(jobs)).not.toContain(secret);
    }
    expect(data.webhook.headers.Authorization).toBe('Bearer header-secret');
  });

  it('retains the individual add path for deduplicated jobs', async () => {
    await sut.queue({ name: JobName.DatabaseBackup, data: {} });
    expect(queue.add).toHaveBeenCalledWith(
      JobName.DatabaseBackup,
      {},
      { deduplication: { id: JobName.DatabaseBackup } },
    );
    expect(queue.addBulk).not.toHaveBeenCalled();
  });
});
