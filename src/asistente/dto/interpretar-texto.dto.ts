import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class InterpretarTextoDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  texto: string;
}
