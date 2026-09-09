import { Body, Controller, Delete, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreatePushSubscriptionDto } from './dto/create-push-subscription.dto.js';
import { DeletePushSubscriptionDto } from './dto/delete-push-subscription.dto.js';

@ApiTags('notificaciones')
@Controller('notificaciones/suscripcion')
export class NotificacionesController {
  constructor(private readonly prisma: PrismaService) {}

  @Post()
  async suscribir(@Body() dto: CreatePushSubscriptionDto) {
    return this.prisma.pushSubscription.upsert({
      where: { endpoint: dto.endpoint },
      create: {
        endpoint: dto.endpoint,
        p256dh: dto.keys.p256dh,
        auth: dto.keys.auth,
      },
      update: {
        p256dh: dto.keys.p256dh,
        auth: dto.keys.auth,
      },
    });
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async desuscribir(@Body() dto: DeletePushSubscriptionDto) {
    await this.prisma.pushSubscription
      .delete({ where: { endpoint: dto.endpoint } })
      .catch(() => undefined);
  }
}
