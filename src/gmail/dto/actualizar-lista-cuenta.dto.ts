import { IsOptional, IsUUID } from 'class-validator';

export class ActualizarListaCuentaDto {
  /** Null (u omitido) = usar la Lista "Correos" compartida por defecto. */
  @IsOptional()
  @IsUUID()
  listaId?: string | null;
}
