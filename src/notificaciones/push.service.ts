import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import webpush from 'web-push';
import { PrismaService } from '../prisma/prisma.service.js';

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);
  private habilitado = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
    this.habilitado = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT);
    if (!this.habilitado) {
      this.logger.warn(
        'Notificaciones push deshabilitadas: faltan VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT en .env',
      );
      return;
    }
    webpush.setVapidDetails(VAPID_SUBJECT!, VAPID_PUBLIC_KEY!, VAPID_PRIVATE_KEY!);
  }

  async enviarATodos(payload: PushPayload): Promise<void> {
    if (!this.habilitado) {
      return;
    }
    const suscripciones = await this.prisma.pushSubscription.findMany();
    await Promise.all(
      suscripciones.map((sub) => this.enviarA(sub, payload)),
    );
  }

  private async enviarA(
    sub: { id: string; endpoint: string; p256dh: string; auth: string },
    payload: PushPayload,
  ): Promise<void> {
    try {
      const resultado = await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        JSON.stringify(payload),
      );
      this.logger.log(`Push enviado a ${sub.endpoint} (status ${resultado.statusCode})`);
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        // La suscripción expiró o el navegador la revocó — ya no sirve, la borramos.
        await this.prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => undefined);
        return;
      }
      this.logger.error(`Falló el envío push a ${sub.endpoint}`, error);
    }
  }
}
