import { Controller, ExecutionContext, Get, INestApplication, Module, UnauthorizedException, HttpException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { LoggingModule } from './logging.module';

@Controller('logging-test')
class TestController {
  @Get(':id') get() { return { ok: true }; }
}
@Module({ imports: [PrismaModule, LoggingModule], controllers: [TestController] })
class TestModule {}

describe('HTTP action logging before guards', () => {
  let app: INestApplication;
  let origin: string;
  const create = jest.fn().mockResolvedValue({});
  const findFirst = jest.fn().mockResolvedValue(null);
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [TestModule], providers: [{
      provide: APP_GUARD,
      useValue: { canActivate(context: ExecutionContext) {
        const req = context.switchToHttp().getRequest();
        if (req.headers['x-test-status'] === '401') throw new UnauthorizedException('secret-error');
        if (req.headers['x-test-status'] === '429') throw new HttpException('secret-error', 429);
        if (req.headers['x-test-user']) req.user = { id: 'owner' };
        return true;
      } },
    }] }).overrideProvider(PrismaService).useValue({ actionLog: { create }, device: { findFirst } }).compile();
    app = module.createNestApplication();
    await app.listen(0, '127.0.0.1');
    origin = await app.getUrl();
  });
  afterAll(async () => { await app?.close(); });
  beforeEach(() => { create.mockClear(); findFirst.mockClear(); });
  async function send(headers: Record<string, string>) {
    await fetch(`${origin}/logging-test/secret-path?token=secret-query`, { headers });
    for (let n = 0; n < 30 && !create.mock.calls.length; n++) await new Promise(r => setTimeout(r, 10));
    expect(create).toHaveBeenCalledTimes(1);
    return create.mock.calls[0][0].data;
  }
  it.each(['401', '429'])('records guard rejection %s with pre-login metadata and no secrets', async status => {
    const data = await send({ 'x-test-status': status, 'x-device-platform': 'IOS', 'x-device-model': 'iPhone%2018', 'x-app-version': '1.0', authorization: 'Bearer secret-token', 'x-device-id': 'someone-elses-device' });
    expect(data.action).toBe('GET /logging-test/:id');
    expect(data.platform).toBe('IOS');
    expect(data.metadata).toMatchObject({ statusCode: Number(status), deviceModel: 'iPhone 18', deviceOwnershipVerified: false });
    expect(findFirst).not.toHaveBeenCalled();
    expect(JSON.stringify(data)).not.toContain('secret');
  });
  it('checks ownership and never attaches a foreign device', async () => {
    const data = await send({ 'x-test-user': 'yes', 'x-device-id': 'foreign' });
    expect(findFirst).toHaveBeenCalledWith({ where: { id: 'foreign', userId: 'owner' } });
    expect(data.deviceId).toBeUndefined();
  });
  it('snapshots registered device metadata without requiring client headers', async () => {
    findFirst.mockResolvedValueOnce({ id: 'mine', platform: 'ANDROID', model: 'Pixel 9', appVersion: '2' });
    const data = await send({ 'x-test-user': 'yes', 'x-device-id': 'mine' });
    expect(data).toMatchObject({ deviceId: 'mine', platform: 'ANDROID', appVersion: '2', metadata: { deviceModel: 'Pixel 9', deviceOwnershipVerified: true } });
  });
});
