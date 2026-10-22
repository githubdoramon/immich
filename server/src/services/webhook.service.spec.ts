import { ModuleRef } from '@nestjs/core';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IWebhookJob } from 'src/types.js';
import { JobName, JobStatus } from 'src/enum.js';
import { ConfigRepository } from 'src/repositories/config.repository.js';
import { EventRepository } from 'src/repositories/event.repository.js';
import { JobRepository } from 'src/repositories/job.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { WebhookService } from 'src/services/webhook.service.js';
import { PersonFactory } from 'test/factories/person.factory.js';
import { getMocks } from 'test/utils.js';

describe(WebhookService.name, () => {
  let directory: string;
  let events: EventRepository;
  let sut: WebhookService;
  let mocks: ReturnType<typeof getMocks>;
  const target = { id: 'people', events: ['PersonUpdate'], url: 'http://automation:8080/hooks' };

  const configure = async (webhooks: unknown[]) => {
    const configPath = join(directory, 'webhooks.json');
    await writeFile(configPath, JSON.stringify({ webhooks }));
    vi.stubEnv('IMMICH_WEBHOOKS_CONFIG', configPath);
    await sut.onBootstrap();
  };

  const job = (): IWebhookJob => ({
    webhook: { id: 'people', url: target.url, method: 'POST', headers: {}, timeout: 100, retries: 4, backoffMs: 250 },
    eventName: 'PersonUpdate',
    payload: { person: { id: 'person-id' } },
    timestamp: '2026-10-22T08:00:00.000Z',
    deliveryId: 'delivery-id',
  });

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'immich-webhooks-'));
    mocks = getMocks();
    events = new EventRepository({} as ModuleRef, {} as ConfigRepository, mocks.logger as unknown as LoggingRepository);
    sut = new WebhookService(
      events,
      mocks.job as unknown as JobRepository,
      mocks.logger as unknown as LoggingRepository,
    );
    vi.stubEnv('IMMICH_WEBHOOKS_CONFIG', '');
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    await rm(directory, { recursive: true, force: true });
  });

  it('remains disabled without a configuration path', async () => {
    await sut.onBootstrap();
    await events.emit('PersonCreate', { person: PersonFactory.create() });
    expect(mocks.job.queue).not.toHaveBeenCalled();
  });

  it('queues subscribed events once and preserves legacy IDs without sharing user data', async () => {
    await configure([{ ...target, retries: 5, backoffMs: 3000, headers: { Authorization: 'Bearer test-token' } }]);
    await sut.onBootstrap();
    const person = PersonFactory.create({ sharedBy: [{ id: 'private-user' } as never] });
    const previous = { ...person, name: 'Before' };
    await events.emit('PersonUpdate', { person, previous, actorId: person.ownerId });
    expect(mocks.job.queue).toHaveBeenCalledTimes(1);
    const item = mocks.job.queue.mock.calls[0][0];
    expect(item).toMatchObject({
      name: JobName.WebhookDelivery,
      data: {
        webhook: { retries: 5, backoffMs: 3000, timeout: 10_000, headers: { Authorization: 'Bearer test-token' } },
        eventName: 'PersonUpdate',
        payload: {
          actorId: person.ownerId,
          person: { id: person.personGroupId, personGroupId: person.personGroupId, ownerId: person.ownerId },
          previous: { id: person.personGroupId, name: 'Before' },
        },
      },
    });
    const serialized = JSON.stringify(item);
    expect(serialized).not.toContain('sharedBy');
    expect(serialized).not.toContain('private-user');
    await events.emit('PersonDelete', { person });
    expect(mocks.job.queue).toHaveBeenCalledTimes(1);
  });

  it('filters server-originated events unless explicitly enabled', async () => {
    await configure([target, { ...target, id: 'including-server', includeServerEvents: true }]);
    const person = PersonFactory.create();
    await events.onEvent({ name: 'PersonUpdate', args: [{ person, previous: person }], server: true });
    expect(mocks.job.queue).toHaveBeenCalledTimes(1);
    expect(mocks.job.queue).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ webhook: expect.objectContaining({ id: 'including-server' }) }),
      }),
    );
  });

  it.each([
    [{ ...target, retries: 0 }],
    [{ ...target, headers: { Authorization: 123 } }],
    [{ ...target, url: 'file:///etc/passwd' }],
  ])('rejects invalid configuration: %j', async (...webhooks) => {
    await configure(webhooks);
    const person = PersonFactory.create();
    await events.emit('PersonUpdate', { person, previous: person });
    expect(mocks.job.queue).not.toHaveBeenCalled();
    expect(mocks.logger.error).toHaveBeenCalled();
  });

  it('delivers the envelope and default headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const data = job();
    await expect(sut.handleWebhookDelivery(data)).resolves.toBe(JobStatus.Success);
    expect(fetchMock).toHaveBeenCalledWith(
      target.url,
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Immich-Event': data.eventName,
          'X-Immich-Delivery-Id': data.deliveryId,
          'X-Immich-Timestamp': data.timestamp,
        },
        body: JSON.stringify({
          id: data.deliveryId,
          eventName: data.eventName,
          timestamp: data.timestamp,
          payload: data.payload,
        }),
      }),
    );
  });

  it('preserves case-insensitive header overrides and HTTP methods', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const data = job();
    data.webhook.method = 'PATCH';
    data.webhook.headers = { 'content-type': 'application/custom', 'x-immich-event': 'custom-event' };
    await sut.handleWebhookDelivery(data);
    const options = fetchMock.mock.calls[0][1];
    expect(options.method).toBe('PATCH');
    expect(options.headers['content-type']).toBe('application/custom');
    expect(options.headers['Content-Type']).toBeUndefined();
    expect(options.headers['x-immich-event']).toBe('custom-event');
  });

  it('throws on non-success responses so BullMQ retries the delivery', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Unavailable', { status: 503 })));
    await expect(sut.handleWebhookDelivery(job())).rejects.toThrow('503');
  });

  it('aborts timed out deliveries so BullMQ can retry', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url, options) =>
          new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(new Error('Aborted')));
          }),
      ),
    );
    const result = expect(sut.handleWebhookDelivery(job())).rejects.toThrow('Aborted');
    await vi.advanceTimersByTimeAsync(101);
    await result;
  });
});
