import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class InterpretarTextoDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  texto: string;

  /**
   * Zona horaria IANA del navegador (ej. "America/Caracas"), enviada por el
   * frontend vía Intl.DateTimeFormat().resolvedOptions().timeZone. Sin esto,
   * el asistente no tiene forma de saber en qué zona interpretar "4 de la
   * tarde" y resuelve las horas relativas en UTC — ver AsistenteService.
   */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  zonaHoraria?: string;
}
