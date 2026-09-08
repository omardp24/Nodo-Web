import { PartialType } from '@nestjs/mapped-types';
import { CreateRecordatorioDto } from './create-recordatorio.dto.js';

export class UpdateRecordatorioDto extends PartialType(CreateRecordatorioDto) {}
