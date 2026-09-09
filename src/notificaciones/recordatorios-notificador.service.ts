import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { PushService } from './push.service.js';

@Injectable()
export class RecordatoriosNotificadorService {
  private readonly logger = new Logger(RecordatoriosNotificadorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async notificarVencidos(): Promise<void> {
    try {
      const ahora = new Date();
      const vencidos = await this.prisma.recordatorio.findMany({
        where: {
          estado: 'PENDIENTE',
          notificadoEn: null,
          fechaLimite: { lte: ahora },
        },
      });

      for (const recordatorio of vencidos) {
        await this.push.enviarATodos({
          title: recordatorio.titulo,
          body: recordatorio.monto
            ? `Pagar ${recordatorio.monto}${recordatorio.banco ? ` · ${recordatorio.banco}` : ''}`
            : (recordatorio.descripcion ?? 'Es hora de este recordatorio'),
          data: { recordatorioId: recordatorio.id },
        });
        await this.prisma.recordatorio.update({
          where: { id: recordatorio.id },
          data: { notificadoEn: ahora },
        });
      }
    } catch (error) {
      this.logger.error('Falló el ciclo de notificaciones de recordatorios', error);
    }
  }
}
