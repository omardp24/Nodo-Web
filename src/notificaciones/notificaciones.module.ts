import { Module } from '@nestjs/common';
import { NotificacionesController } from './notificaciones.controller.js';
import { PushService } from './push.service.js';
import { RecordatoriosNotificadorService } from './recordatorios-notificador.service.js';

@Module({
  controllers: [NotificacionesController],
  providers: [PushService, RecordatoriosNotificadorService],
})
export class NotificacionesModule {}
