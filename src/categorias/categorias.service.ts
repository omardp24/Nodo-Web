import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateCategoriaDto } from './dto/create-categoria.dto.js';
import { UpdateCategoriaDto } from './dto/update-categoria.dto.js';

@Injectable()
export class CategoriasService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertListaExiste(listaId: string) {
    const lista = await this.prisma.lista.findUnique({ where: { id: listaId } });
    if (!lista) {
      throw new NotFoundException(`Lista ${listaId} no encontrada`);
    }
  }

  async create(dto: CreateCategoriaDto) {
    await this.assertListaExiste(dto.listaId);
    return this.prisma.categoria.create({ data: dto });
  }

  findAll(listaId?: string) {
    return this.prisma.categoria.findMany({
      where: listaId ? { listaId } : undefined,
      orderBy: { nombre: 'asc' },
    });
  }

  async findOne(id: string) {
    const categoria = await this.prisma.categoria.findUnique({
      where: { id },
      include: { recordatorios: true },
    });
    if (!categoria) {
      throw new NotFoundException(`Categoria ${id} no encontrada`);
    }
    return categoria;
  }

  async update(id: string, dto: UpdateCategoriaDto) {
    await this.findOne(id);
    if (dto.listaId) {
      await this.assertListaExiste(dto.listaId);
    }
    return this.prisma.categoria.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.categoria.delete({ where: { id } });
  }
}
