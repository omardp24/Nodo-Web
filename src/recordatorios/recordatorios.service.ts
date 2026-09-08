import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateRecordatorioDto } from './dto/create-recordatorio.dto.js';
import { UpdateRecordatorioDto } from './dto/update-recordatorio.dto.js';
import { EstadoRecordatorio } from '../generated/prisma/enums.js';

@Injectable()
export class RecordatoriosService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertCategoriaExiste(categoriaId: string) {
    const categoria = await this.prisma.categoria.findUnique({
      where: { id: categoriaId },
    });
    if (!categoria) {
      throw new NotFoundException(`Categoria ${categoriaId} no encontrada`);
    }
  }

  async create(dto: CreateRecordatorioDto) {
    await this.assertCategoriaExiste(dto.categoriaId);
    const { fechaLimite, ...rest } = dto;
    return this.prisma.recordatorio.create({
      data: {
        ...rest,
        fechaLimite: fechaLimite ? new Date(fechaLimite) : undefined,
      },
    });
  }

  findAll(categoriaId?: string, estado?: EstadoRecordatorio) {
    return this.prisma.recordatorio.findMany({
      where: {
        ...(categoriaId && { categoriaId }),
        ...(estado && { estado }),
      },
      orderBy: { fechaLimite: 'asc' },
      include: { categoria: true },
    });
  }

  async findOne(id: string) {
    const recordatorio = await this.prisma.recordatorio.findUnique({
      where: { id },
      include: { categoria: true },
    });
    if (!recordatorio) {
      throw new NotFoundException(`Recordatorio ${id} no encontrado`);
    }
    return recordatorio;
  }

  async update(id: string, dto: UpdateRecordatorioDto) {
    await this.findOne(id);
    if (dto.categoriaId) {
      await this.assertCategoriaExiste(dto.categoriaId);
    }
    const { fechaLimite, ...rest } = dto;
    return this.prisma.recordatorio.update({
      where: { id },
      data: {
        ...rest,
        ...(fechaLimite !== undefined && { fechaLimite: new Date(fechaLimite) }),
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.recordatorio.delete({ where: { id } });
  }
}
