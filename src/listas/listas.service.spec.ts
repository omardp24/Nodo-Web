import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ListasService } from './listas.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

describe('ListasService', () => {
  let service: ListasService;
  const prisma = {
    lista: {
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
      providers: [ListasService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(ListasService);
  });

  it('create delega en prisma.lista.create', async () => {
    prisma.lista.create.mockResolvedValue({ id: '1', nombre: 'Trabajo' });

    const result = await service.create({ nombre: 'Trabajo' });

    expect(prisma.lista.create).toHaveBeenCalledWith({ data: { nombre: 'Trabajo' } });
    expect(result).toEqual({ id: '1', nombre: 'Trabajo' });
  });

  it('findOne lanza NotFoundException si no existe', async () => {
    prisma.lista.findUnique.mockResolvedValue(null);

    await expect(service.findOne('no-existe')).rejects.toThrow(NotFoundException);
  });

  it('findOne devuelve la lista con sus categorias si existe', async () => {
    const lista = { id: '1', nombre: 'Trabajo', categorias: [] };
    prisma.lista.findUnique.mockResolvedValue(lista);

    const result = await service.findOne('1');

    expect(prisma.lista.findUnique).toHaveBeenCalledWith({
      where: { id: '1' },
      include: { categorias: true },
    });
    expect(result).toEqual(lista);
  });

  it('update lanza NotFoundException si la lista no existe', async () => {
    prisma.lista.findUnique.mockResolvedValue(null);

    await expect(service.update('no-existe', { nombre: 'X' })).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.lista.update).not.toHaveBeenCalled();
  });

  it('update aplica los cambios si la lista existe', async () => {
    prisma.lista.findUnique.mockResolvedValue({ id: '1', nombre: 'Trabajo' });
    prisma.lista.update.mockResolvedValue({ id: '1', nombre: 'Personal' });

    const result = await service.update('1', { nombre: 'Personal' });

    expect(prisma.lista.update).toHaveBeenCalledWith({
      where: { id: '1' },
      data: { nombre: 'Personal' },
    });
    expect(result).toEqual({ id: '1', nombre: 'Personal' });
  });

  it('remove lanza NotFoundException si la lista no existe', async () => {
    prisma.lista.findUnique.mockResolvedValue(null);

    await expect(service.remove('no-existe')).rejects.toThrow(NotFoundException);
    expect(prisma.lista.delete).not.toHaveBeenCalled();
  });

  it('remove elimina la lista si existe', async () => {
    prisma.lista.findUnique.mockResolvedValue({ id: '1', nombre: 'Trabajo' });
    prisma.lista.delete.mockResolvedValue({ id: '1', nombre: 'Trabajo' });

    const result = await service.remove('1');

    expect(prisma.lista.delete).toHaveBeenCalledWith({ where: { id: '1' } });
    expect(result).toEqual({ id: '1', nombre: 'Trabajo' });
  });
});
