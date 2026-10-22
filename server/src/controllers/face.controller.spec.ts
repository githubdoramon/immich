import { ForbiddenException } from '@nestjs/common';
import { unlink } from 'node:fs/promises';
import request from 'supertest';
import { FaceController } from 'src/controllers/face.controller.js';
import { Permission } from 'src/enum.js';
import { PersonService } from 'src/services/person.service.js';
import { newUuid } from 'test/small.factory.js';
import { type ControllerContext, controllerSetup, mockBaseService } from 'test/utils.js';

describe('Custom face identification route', () => {
  let ctx: ControllerContext;
  const service = mockBaseService(PersonService);

  beforeAll(async () => {
    ctx = await controllerSetup(FaceController, [{ provide: PersonService, useValue: service }]);
    return () => ctx.close();
  });

  beforeEach(() => {
    service.resetAllMocks();
    ctx.reset();
  });

  afterEach(async () => {
    for (const [, file] of service.identifyFaces.mock.calls) {
      await unlink(file.path).catch(() => {});
    }
  });

  it('requires a file', async () => {
    const { status } = await request(ctx.getHttpServer()).post('/faces/identify');
    expect(status).toBe(400);
    expect(service.identifyFaces).not.toHaveBeenCalled();
  });

  it('accepts multipart uploads and preserves the ID-only response', async () => {
    const personId = newUuid();
    service.identifyFaces.mockResolvedValue([
      {
        id: 'not-used',
        personId,
        imageHeight: 200,
        imageWidth: 100,
        boundingBoxX1: 10,
        boundingBoxX2: 50,
        boundingBoxY1: 20,
        boundingBoxY2: 60,
      },
    ]);
    const { status, body } = await request(ctx.getHttpServer())
      .post('/faces/identify')
      .attach('file', Buffer.from('image'), 'face.jpg');
    expect(status).toBe(201);
    expect(body).toEqual([expect.objectContaining({ personId, id: 'not-used' })]);
    expect(service.identifyFaces).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ originalname: 'face.jpg' }),
    );
  });

  it('passes FaceRead permission to authentication before handling uploads', async () => {
    ctx.authenticate.mockRejectedValue(new ForbiddenException());
    const { status } = await request(ctx.getHttpServer())
      .post('/faces/identify')
      .attach('file', Buffer.from('image'), 'face.jpg');
    expect(status).toBe(403);
    expect(ctx.authenticate).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ permission: Permission.FaceRead }) }),
    );
    expect(service.identifyFaces).not.toHaveBeenCalled();
  });

  it('rejects files larger than 20 MiB', async () => {
    const { status } = await request(ctx.getHttpServer())
      .post('/faces/identify')
      .attach('file', Buffer.alloc(20 * 1024 * 1024 + 1), 'large.jpg');
    expect(status).toBe(413);
    expect(service.identifyFaces).not.toHaveBeenCalled();
  });
});
