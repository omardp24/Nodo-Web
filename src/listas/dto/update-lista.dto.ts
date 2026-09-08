import { PartialType } from '@nestjs/mapped-types';
import { CreateListaDto } from './create-lista.dto.js';

export class UpdateListaDto extends PartialType(CreateListaDto) {}
