import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AsistenteService } from './asistente.service.js';
import { InterpretarTextoDto } from './dto/interpretar-texto.dto.js';

@ApiTags('asistente')
@Controller('asistente')
export class AsistenteController {
  constructor(private readonly asistente: AsistenteService) {}

  @Post('interpretar')
  interpretar(@Body() dto: InterpretarTextoDto) {
    return this.asistente.interpretar(dto.texto);
  }
}
