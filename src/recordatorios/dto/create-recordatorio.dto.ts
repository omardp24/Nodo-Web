import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
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

  /** Solo aplica a recordatorios de pago. */
  @IsOptional()
  @IsNumber()
  @IsPositive()
  monto?: number;

  /** Banco al que se le paga. Solo aplica a recordatorios de pago. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  banco?: string;

  @IsUUID()
  categoriaId: string;
}
