import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateListaDto } from './dto/create-lista.dto.js';
import { UpdateListaDto } from './dto/update-lista.dto.js';

@Injectable()
export class ListasService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateListaDto) {
    return this.prisma.lista.create({ data: dto });
  }

  findAll() {
    return this.prisma.lista.findMany({
      orderBy: { nombre: 'asc' },
    });
  }

  async findOne(id: string) {
    const lista = await this.prisma.lista.findUnique({
      where: { id },
      include: { categorias: true },
    });
    if (!lista) {
      throw new NotFoundException(`Lista ${id} no encontrada`);
    }
    return lista;
  }

  async update(id: string, dto: UpdateListaDto) {
    await this.findOne(id);
    return this.prisma.lista.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.lista.delete({ where: { id } });
  }
}
