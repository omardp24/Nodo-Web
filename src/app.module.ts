import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ListasModule } from './listas/listas.module.js';
import { CategoriasModule } from './categorias/categorias.module.js';
import { RecordatoriosModule } from './recordatorios/recordatorios.module.js';
import { GmailModule } from './gmail/gmail.module.js';
import { NotificacionesModule } from './notificaciones/notificaciones.module.js';
import { AsistenteModule } from './asistente/asistente.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    ListasModule,
    CategoriasModule,
    RecordatoriosModule,
    GmailModule,
    NotificacionesModule,
    AsistenteModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
