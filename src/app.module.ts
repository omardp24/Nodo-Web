import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ListasModule } from './listas/listas.module.js';
import { CategoriasModule } from './categorias/categorias.module.js';
import { RecordatoriosModule } from './recordatorios/recordatorios.module.js';
import { GmailModule } from './gmail/gmail.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    ListasModule,
    CategoriasModule,
    RecordatoriosModule,
    GmailModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
