import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RecordatoriosService } from './recordatorios.service.js';
import { CreateRecordatorioDto } from './dto/create-recordatorio.dto.js';
import { UpdateRecordatorioDto } from './dto/update-recordatorio.dto.js';
import { EstadoRecordatorio } from '../generated/prisma/enums.js';

@ApiTags('recordatorios')
@ApiBearerAuth()
@Controller('recordatorios')
export class RecordatoriosController {
  constructor(private readonly recordatoriosService: RecordatoriosService) {}

  @Post()
  create(@Body() createRecordatorioDto: CreateRecordatorioDto) {
    return this.recordatoriosService.create(createRecordatorioDto);
  }

  @Get()
  findAll(
    @Query('categoriaId') categoriaId?: string,
    @Query('estado') estado?: EstadoRecordatorio,
  ) {
    return this.recordatoriosService.findAll(categoriaId, estado);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.recordatoriosService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateRecordatorioDto: UpdateRecordatorioDto,
  ) {
    return this.recordatoriosService.update(id, updateRecordatorioDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.recordatoriosService.remove(id);
  }
}
