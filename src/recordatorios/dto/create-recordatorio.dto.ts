import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import {
  EstadoRecordatorio,
  OrigenRecordatorio,
  Prioridad,
} from '../../generated/prisma/enums.js';

export class CreateRecordatorioDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  titulo: string;

  @IsOptional()
  @IsString()
  descripcion?: string;

  @IsOptional()
  @IsDateString()
  fechaLimite?: string;

  @IsOptional()
  @IsEnum(Prioridad)
  prioridad?: Prioridad;

  @IsOptional()
  @IsEnum(EstadoRecordatorio)
  estado?: EstadoRecordatorio;

  @IsOptional()
  @IsEnum(OrigenRecordatorio)
  origen?: OrigenRecordatorio;

  @IsUUID()
  categoriaId: string;
}
