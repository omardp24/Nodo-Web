import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ListasService } from './listas.service.js';
import { CreateListaDto } from './dto/create-lista.dto.js';
import { UpdateListaDto } from './dto/update-lista.dto.js';

@ApiTags('listas')
@ApiBearerAuth()
@Controller('listas')
export class ListasController {
  constructor(private readonly listasService: ListasService) {}

  @Post()
  create(@Body() createListaDto: CreateListaDto) {
    return this.listasService.create(createListaDto);
  }

  @Get()
  findAll() {
    return this.listasService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.listasService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateListaDto: UpdateListaDto) {
    return this.listasService.update(id, updateListaDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.listasService.remove(id);
  }
}
