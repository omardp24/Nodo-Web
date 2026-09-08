import { Module } from '@nestjs/common';
import { RecordatoriosService } from './recordatorios.service.js';
import { RecordatoriosController } from './recordatorios.controller.js';

@Module({
  controllers: [RecordatoriosController],
  providers: [RecordatoriosService],
  exports: [RecordatoriosService],
})
export class RecordatoriosModule {}
