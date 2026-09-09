import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { RecordatoriosService } from './recordatorios.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

describe('RecordatoriosService', () => {
  let service: RecordatoriosService;
  const prisma = {
    categoria: { findUnique: vi.fn() },
    recordatorio: {
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
      providers: [RecordatoriosService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(RecordatoriosService);
  });

  it('create lanza NotFoundException si la categoria no existe', async () => {
    prisma.categoria.findUnique.mockResolvedValue(null);

    await expect(
      service.create({ titulo: 'Pagar factura', categoriaId: 'c-fantasma' }),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.recordatorio.create).not.toHaveBeenCalled();
  });

  it('create convierte fechaLimite a Date y delega en prisma', async () => {
    prisma.categoria.findUnique.mockResolvedValue({ id: 'c1' });
    prisma.recordatorio.create.mockResolvedValue({ id: 'r1' });

    await service.create({
      titulo: 'Pagar factura',
      categoriaId: 'c1',
      fechaLimite: '2026-09-30T00:00:00.000Z',
    });

    expect(prisma.recordatorio.create).toHaveBeenCalledWith({
      data: {
        titulo: 'Pagar factura',
        categoriaId: 'c1',
        fechaLimite: new Date('2026-09-30T00:00:00.000Z'),
      },
    });
  });

  it('create no incluye fechaLimite si no se provee', async () => {
    prisma.categoria.findUnique.mockResolvedValue({ id: 'c1' });
    prisma.recordatorio.create.mockResolvedValue({ id: 'r1' });

    await service.create({ titulo: 'Pagar factura', categoriaId: 'c1' });

    expect(prisma.recordatorio.create).toHaveBeenCalledWith({
      data: { titulo: 'Pagar factura', categoriaId: 'c1', fechaLimite: undefined },
    });
  });

  it('findAll combina filtros de categoriaId y estado', async () => {
    prisma.recordatorio.findMany.mockResolvedValue([]);

    await service.findAll('c1', 'PENDIENTE');

    expect(prisma.recordatorio.findMany).toHaveBeenCalledWith({
      where: { categoriaId: 'c1', estado: 'PENDIENTE' },
      orderBy: { fechaLimite: 'asc' },
      include: { categoria: { include: { lista: true } } },
    });
  });

  it('findOne lanza NotFoundException si no existe', async () => {
    prisma.recordatorio.findUnique.mockResolvedValue(null);

    await expect(service.findOne('no-existe')).rejects.toThrow(NotFoundException);
  });

  it('update valida la nueva categoriaId si se cambia', async () => {
    prisma.recordatorio.findUnique.mockResolvedValue({ id: 'r1', categoriaId: 'c1' });
    prisma.categoria.findUnique.mockResolvedValue(null);

    await expect(
      service.update('r1', { categoriaId: 'c-fantasma' }),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.recordatorio.update).not.toHaveBeenCalled();
  });

  it('remove elimina el recordatorio si existe', async () => {
    prisma.recordatorio.findUnique.mockResolvedValue({ id: 'r1' });
    prisma.recordatorio.delete.mockResolvedValue({ id: 'r1' });

    const result = await service.remove('r1');

    expect(prisma.recordatorio.delete).toHaveBeenCalledWith({ where: { id: 'r1' } });
    expect(result).toEqual({ id: 'r1' });
  });
});
