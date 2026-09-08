import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateListaDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  nombre: string;
}
