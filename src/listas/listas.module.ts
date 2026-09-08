import { Module } from '@nestjs/common';
import { ListasService } from './listas.service.js';
import { ListasController } from './listas.controller.js';

@Module({
  controllers: [ListasController],
  providers: [ListasService],
  exports: [ListasService],
})
export class ListasModule {}
