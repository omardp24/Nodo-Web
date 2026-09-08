import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { CategoriasService } from './categorias.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

describe('CategoriasService', () => {
  let service: CategoriasService;
  const prisma = {
    lista: { findUnique: vi.fn() },
    categoria: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [CategoriasService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(CategoriasService);
  });

  it('create lanza NotFoundException si la lista no existe', async () => {
    prisma.lista.findUnique.mockResolvedValue(null);

    await expect(
      service.create({ nombre: 'CAD - Finanzas', listaId: 'lista-fantasma' }),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.categoria.create).not.toHaveBeenCalled();
  });

  it('create crea la categoria si la lista existe', async () => {
    prisma.lista.findUnique.mockResolvedValue({ id: 'l1', nombre: 'Trabajo' });
    prisma.categoria.create.mockResolvedValue({ id: 'c1', nombre: 'CAD - Finanzas', listaId: 'l1' });

    const result = await service.create({ nombre: 'CAD - Finanzas', listaId: 'l1' });

    expect(prisma.categoria.create).toHaveBeenCalledWith({
      data: { nombre: 'CAD - Finanzas', listaId: 'l1' },
    });
    expect(result).toEqual({ id: 'c1', nombre: 'CAD - Finanzas', listaId: 'l1' });
  });

  it('findAll filtra por listaId cuando se provee', async () => {
    prisma.categoria.findMany.mockResolvedValue([]);

    await service.findAll('l1');

    expect(prisma.categoria.findMany).toHaveBeenCalledWith({
      where: { listaId: 'l1' },
      orderBy: { nombre: 'asc' },
    });
  });

  it('findAll no filtra cuando no se provee listaId', async () => {
    prisma.categoria.findMany.mockResolvedValue([]);

    await service.findAll();

    expect(prisma.categoria.findMany).toHaveBeenCalledWith({
      where: undefined,
      orderBy: { nombre: 'asc' },
    });
  });

  it('findOne lanza NotFoundException si no existe', async () => {
    prisma.categoria.findUnique.mockResolvedValue(null);

    await expect(service.findOne('no-existe')).rejects.toThrow(NotFoundException);
  });

  it('update valida la nueva listaId si se cambia', async () => {
    prisma.categoria.findUnique.mockResolvedValue({ id: 'c1', nombre: 'X', listaId: 'l1' });
    prisma.lista.findUnique.mockResolvedValue(null);

    await expect(service.update('c1', { listaId: 'lista-fantasma' })).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.categoria.update).not.toHaveBeenCalled();
  });

  it('remove elimina la categoria si existe', async () => {
    prisma.categoria.findUnique.mockResolvedValue({ id: 'c1', nombre: 'X', listaId: 'l1' });
    prisma.categoria.delete.mockResolvedValue({ id: 'c1', nombre: 'X', listaId: 'l1' });

    const result = await service.remove('c1');

    expect(prisma.categoria.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
    expect(result).toEqual({ id: 'c1', nombre: 'X', listaId: 'l1' });
  });
});
