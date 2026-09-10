import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { PushService } from './push.service.js';

/**
 * Cada cuántas horas se re-notifica un nodo de correo sin fecha límite mientras siga
 * PENDIENTE. Correos como "Atencion Omar Importante" son accionables pero no siempre
 * traen una fecha explícita — sin este recordatorio periódico, una sola notificación
 * (o ninguna, si se creó fuera de horario) es fácil de perder de vista para siempre.
 */
function repetirCadaMs(): number {
  const horas = Number(process.env.RECORDATORIO_REPETIR_HORAS ?? '4');
  return (Number.isFinite(horas) && horas > 0 ? horas : 4) * 60 * 60 * 1000;
}

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
        await this.notificarYMarcar(recordatorio, ahora);
      }
    } catch (error) {
      this.logger.error('Falló el ciclo de notificaciones de recordatorios', error);
    }
  }

  /**
   * Nodos de correo accionables pero sin fecha límite: a diferencia de `notificarVencidos`
   * (que notifica UNA sola vez), estos se re-notifican cada `RECORDATORIO_REPETIR_HORAS`
   * mientras sigan PENDIENTE — acá `notificadoEn` significa "última vez que se avisó",
   * no "ya se avisó alguna vez". Se detiene solo, sin lógica extra, en cuanto el nodo
   * pasa a COMPLETADO (deja de matchear el where) o se le asigna una fechaLimite (pasa a
   * ser responsabilidad de `notificarVencidos` en su lugar).
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async recordarPendientesSinFecha(): Promise<void> {
    try {
      const ahora = new Date();
      const limite = new Date(ahora.getTime() - repetirCadaMs());
      const pendientes = await this.prisma.recordatorio.findMany({
        where: {
          estado: 'PENDIENTE',
          origen: 'CORREO',
          fechaLimite: null,
          OR: [{ notificadoEn: null }, { notificadoEn: { lte: limite } }],
        },
      });

      for (const recordatorio of pendientes) {
        await this.notificarYMarcar(recordatorio, ahora);
      }
    } catch (error) {
      this.logger.error('Falló el ciclo de recordatorios repetidos sin fecha', error);
    }
  }

  private async notificarYMarcar(
    recordatorio: { id: string; titulo: string; descripcion: string | null; monto: number | null; banco: string | null },
    ahora: Date,
  ): Promise<void> {
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
}
