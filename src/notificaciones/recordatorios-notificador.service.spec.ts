import { Test, TestingModule } from '@nestjs/testing';
import { RecordatoriosNotificadorService } from './recordatorios-notificador.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PushService } from './push.service.js';

describe('RecordatoriosNotificadorService', () => {
  let service: RecordatoriosNotificadorService;
  const prisma = {
    recordatorio: { findMany: vi.fn(), update: vi.fn() },
  };
  const push = { enviarATodos: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecordatoriosNotificadorService,
        { provide: PrismaService, useValue: prisma },
        { provide: PushService, useValue: push },
      ],
    }).compile();

    service = module.get(RecordatoriosNotificadorService);
  });

  it('no hace nada si no hay recordatorios vencidos', async () => {
    prisma.recordatorio.findMany.mockResolvedValue([]);

    await service.notificarVencidos();

    expect(push.enviarATodos).not.toHaveBeenCalled();
    expect(prisma.recordatorio.update).not.toHaveBeenCalled();
  });

  it('solo busca PENDIENTE, no notificados, con fechaLimite ya cumplida', async () => {
    prisma.recordatorio.findMany.mockResolvedValue([]);

    await service.notificarVencidos();

    expect(prisma.recordatorio.findMany).toHaveBeenCalledWith({
      where: {
        estado: 'PENDIENTE',
        notificadoEn: null,
        fechaLimite: { lte: expect.any(Date) },
      },
    });
  });

  it('notifica y marca notificadoEn para cada recordatorio vencido', async () => {
    prisma.recordatorio.findMany.mockResolvedValue([
      { id: 'r1', titulo: 'Llamar al banco', descripcion: null, monto: null, banco: null },
      { id: 'r2', titulo: 'Pagar tarjeta', descripcion: null, monto: 250, banco: 'Banesco' },
    ]);

    await service.notificarVencidos();

    expect(push.enviarATodos).toHaveBeenCalledTimes(2);
    expect(push.enviarATodos).toHaveBeenCalledWith({
      title: 'Llamar al banco',
      body: 'Es hora de este recordatorio',
      data: { recordatorioId: 'r1' },
    });
    expect(push.enviarATodos).toHaveBeenCalledWith({
      title: 'Pagar tarjeta',
      body: 'Pagar 250 · Banesco',
      data: { recordatorioId: 'r2' },
    });
    expect(prisma.recordatorio.update).toHaveBeenCalledTimes(2);
    expect(prisma.recordatorio.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { notificadoEn: expect.any(Date) },
    });
  });

  it('no propaga errores si falla el envío push', async () => {
    prisma.recordatorio.findMany.mockRejectedValue(new Error('DB caída'));

    await expect(service.notificarVencidos()).resolves.toBeUndefined();
  });
});
