import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { GmailAccountsService } from './gmail-accounts.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

describe('GmailAccountsService', () => {
  let service: GmailAccountsService;
  const prisma = {
    lista: { findUnique: vi.fn() },
    cuentaGmail: { update: vi.fn() },
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [GmailAccountsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(GmailAccountsService);
  });

  describe('actualizarLista', () => {
    it('lanza NotFoundException si la lista destino no existe', async () => {
      prisma.lista.findUnique.mockResolvedValue(null);

      await expect(service.actualizarLista('cuenta-1', 'lista-fantasma')).rejects.toThrow(NotFoundException);
      expect(prisma.cuentaGmail.update).not.toHaveBeenCalled();
    });

    it('actualiza listaId si la lista existe', async () => {
      prisma.lista.findUnique.mockResolvedValue({ id: 'lista-trabajo' });
      prisma.cuentaGmail.update.mockResolvedValue({ id: 'cuenta-1', listaId: 'lista-trabajo' });

      await service.actualizarLista('cuenta-1', 'lista-trabajo');

      expect(prisma.cuentaGmail.update).toHaveBeenCalledWith({
        where: { id: 'cuenta-1' },
        data: { listaId: 'lista-trabajo' },
        select: { id: true, email: true, filtrarPorPrincipal: true, listaId: true, createdAt: true },
      });
    });

    it('no valida ninguna lista si listaId es null (vuelve a la Lista "Correos" por defecto)', async () => {
      prisma.cuentaGmail.update.mockResolvedValue({ id: 'cuenta-1', listaId: null });

      await service.actualizarLista('cuenta-1', null);

      expect(prisma.lista.findUnique).not.toHaveBeenCalled();
      expect(prisma.cuentaGmail.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { listaId: null } }),
      );
    });

    it('lanza NotFoundException si la cuenta no existe', async () => {
      prisma.cuentaGmail.update.mockRejectedValue(new Error('registro no encontrado'));

      await expect(service.actualizarLista('cuenta-fantasma', null)).rejects.toThrow(NotFoundException);
    });
  });
});
