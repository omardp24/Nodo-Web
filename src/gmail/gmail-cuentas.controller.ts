import { Body, Controller, Delete, Get, Param, Patch } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { GmailAccountsService } from './gmail-accounts.service.js';
import { ActualizarListaCuentaDto } from './dto/actualizar-lista-cuenta.dto.js';

/**
 * A diferencia de GmailAuthController (público, lo visita Google en el redirect),
 * este sí pasa por el guard normal — lo usa el frontend para mostrar y gestionar
 * las cuentas de Gmail conectadas.
 */
@ApiTags('gmail')
@Controller('gmail/cuentas')
export class GmailCuentasController {
  constructor(private readonly cuentas: GmailAccountsService) {}

  @Get()
  listar() {
    return this.cuentas.listarPublico();
  }

  @Patch(':id')
  actualizarLista(@Param('id') id: string, @Body() dto: ActualizarListaCuentaDto) {
    return this.cuentas.actualizarLista(id, dto.listaId ?? null);
  }

  @Delete(':id')
  eliminar(@Param('id') id: string) {
    return this.cuentas.eliminar(id);
  }
}
