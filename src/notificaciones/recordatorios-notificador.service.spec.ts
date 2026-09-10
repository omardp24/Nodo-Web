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
      { id: 'r1', titulo: 'Llamar al banco', descripcion: null, monto: null, banco: null, notificadoEn: null },
      { id: 'r2', titulo: 'Pagar tarjeta', descripcion: null, monto: 250, banco: 'Banesco', notificadoEn: null },
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

  describe('recordarPendientesSinFecha', () => {
    const ENV_ORIGINAL = { ...process.env };

    beforeEach(() => {
      process.env = { ...ENV_ORIGINAL };
    });

    it('busca correos PENDIENTE sin fechaLimite, nunca notificados o notificados hace rato', async () => {
      process.env.RECORDATORIO_REPETIR_HORAS = '4';
      prisma.recordatorio.findMany.mockResolvedValue([]);

      await service.recordarPendientesSinFecha();

      expect(prisma.recordatorio.findMany).toHaveBeenCalledWith({
        where: {
          estado: 'PENDIENTE',
          origen: 'CORREO',
          fechaLimite: null,
          OR: [{ notificadoEn: null }, { notificadoEn: { lte: expect.any(Date) } }],
        },
      });
    });

    it('la primera vez (notificadoEn null) notifica con el resumen tal cual', async () => {
      prisma.recordatorio.findMany.mockResolvedValue([
        { id: 'r1', titulo: 'Atencion Omar', descripcion: 'Enviar el informe', monto: null, banco: null, notificadoEn: null },
      ]);

      await service.recordarPendientesSinFecha();

      expect(push.enviarATodos).toHaveBeenCalledWith({
        title: 'Atencion Omar',
        body: 'Enviar el informe',
        data: { recordatorioId: 'r1' },
      });
      expect(prisma.recordatorio.update).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: { notificadoEn: expect.any(Date) },
      });
    });

    it('a partir de la segunda vez (notificadoEn ya seteado) avisa que sigue sin hacerse', async () => {
      prisma.recordatorio.findMany.mockResolvedValue([
        {
          id: 'r1',
          titulo: 'Atencion Omar',
          descripcion: 'Enviar el informe',
          monto: null,
          banco: null,
          notificadoEn: new Date('2026-09-09T10:00:00.000Z'),
        },
      ]);

      await service.recordarPendientesSinFecha();

      expect(push.enviarATodos).toHaveBeenCalledWith({
        title: 'Atencion Omar',
        body: 'Todavía no lo hiciste: Enviar el informe',
        data: { recordatorioId: 'r1' },
      });
    });

    it('usa 4 horas por defecto si RECORDATORIO_REPETIR_HORAS no es un número válido', async () => {
      process.env.RECORDATORIO_REPETIR_HORAS = 'no-es-un-numero';
      prisma.recordatorio.findMany.mockResolvedValue([]);

      const antes = Date.now();
      await service.recordarPendientesSinFecha();

      const llamada = prisma.recordatorio.findMany.mock.calls[0][0];
      const limite: Date = llamada.where.OR[1].notificadoEn.lte;
      const horasDeDiferencia = (antes - limite.getTime()) / (60 * 60 * 1000);
      expect(horasDeDiferencia).toBeCloseTo(4, 1);
    });

    it('no propaga errores si falla la consulta', async () => {
      prisma.recordatorio.findMany.mockRejectedValue(new Error('DB caída'));

      await expect(service.recordarPendientesSinFecha()).resolves.toBeUndefined();
    });
  });
});
