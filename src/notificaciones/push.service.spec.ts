import { Test, TestingModule } from '@nestjs/testing';
import { PushService } from './push.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const { sendNotificationMock, setVapidDetailsMock } = vi.hoisted(() => ({
  sendNotificationMock: vi.fn(),
  setVapidDetailsMock: vi.fn(),
}));

vi.mock('web-push', () => ({
  default: {
    setVapidDetails: setVapidDetailsMock,
    sendNotification: sendNotificationMock,
  },
}));

describe('PushService', () => {
  let service: PushService;
  const prisma = {
    pushSubscription: { findMany: vi.fn(), delete: vi.fn() },
  };
  const ENV_ORIGINAL = { ...process.env };

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env = { ...ENV_ORIGINAL };
    prisma.pushSubscription.delete.mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [PushService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(PushService);
  });

  it('no envía nada si faltan las VAPID keys en el entorno', async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_SUBJECT;
    service.onModuleInit();

    await service.enviarATodos({ title: 'Hola', body: 'Mundo' });

    expect(prisma.pushSubscription.findMany).not.toHaveBeenCalled();
    expect(sendNotificationMock).not.toHaveBeenCalled();
  });

  describe('con VAPID configurado', () => {
    beforeEach(() => {
      process.env.VAPID_PUBLIC_KEY = 'pub';
      process.env.VAPID_PRIVATE_KEY = 'priv';
      process.env.VAPID_SUBJECT = 'mailto:test@example.com';
      service.onModuleInit();
    });

    it('envía la notificación a todas las suscripciones guardadas', async () => {
      prisma.pushSubscription.findMany.mockResolvedValue([
        { id: 's1', endpoint: 'https://push.example/s1', p256dh: 'a', auth: 'b' },
        { id: 's2', endpoint: 'https://push.example/s2', p256dh: 'c', auth: 'd' },
      ]);
      sendNotificationMock.mockResolvedValue(undefined);

      await service.enviarATodos({ title: 'Pagar factura', body: '250' });

      expect(sendNotificationMock).toHaveBeenCalledTimes(2);
      expect(sendNotificationMock).toHaveBeenCalledWith(
        { endpoint: 'https://push.example/s1', keys: { p256dh: 'a', auth: 'b' } },
        JSON.stringify({ title: 'Pagar factura', body: '250' }),
      );
    });

    it('borra la suscripción si el navegador la revocó (410)', async () => {
      prisma.pushSubscription.findMany.mockResolvedValue([
        { id: 's1', endpoint: 'https://push.example/s1', p256dh: 'a', auth: 'b' },
      ]);
      sendNotificationMock.mockRejectedValue({ statusCode: 410 });

      await service.enviarATodos({ title: 'Hola', body: 'Mundo' });

      expect(prisma.pushSubscription.delete).toHaveBeenCalledWith({ where: { id: 's1' } });
    });

    it('no borra la suscripción en otros errores', async () => {
      prisma.pushSubscription.findMany.mockResolvedValue([
        { id: 's1', endpoint: 'https://push.example/s1', p256dh: 'a', auth: 'b' },
      ]);
      sendNotificationMock.mockRejectedValue({ statusCode: 500 });

      await service.enviarATodos({ title: 'Hola', body: 'Mundo' });

      expect(prisma.pushSubscription.delete).not.toHaveBeenCalled();
    });
  });
});
