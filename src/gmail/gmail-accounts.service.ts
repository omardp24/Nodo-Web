import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CuentaGmail } from '../generated/prisma/client.js';

export interface CuentaGmailPublica {
  id: string;
  email: string;
  filtrarPorPrincipal: boolean;
  listaId: string | null;
  createdAt: Date;
}

@Injectable()
export class GmailAccountsService {
  constructor(private readonly prisma: PrismaService) {}

  listar(): Promise<CuentaGmail[]> {
    return this.prisma.cuentaGmail.findMany({ orderBy: { createdAt: 'asc' } });
  }

  /** Igual que `listar`, sin el refresh_token — lo que sí puede viajar al frontend. */
  async listarPublico(): Promise<CuentaGmailPublica[]> {
    return this.prisma.cuentaGmail.findMany({
      orderBy: { createdAt: 'asc' },
      select: { id: true, email: true, filtrarPorPrincipal: true, listaId: true, createdAt: true },
    });
  }

  /** Guarda (o actualiza el refresh_token de) una cuenta ya identificada por su email. */
  guardar(email: string, refreshToken: string, filtrarPorPrincipal: boolean): Promise<CuentaGmail> {
    return this.prisma.cuentaGmail.upsert({
      where: { email },
      update: { refreshToken, filtrarPorPrincipal },
      create: { email, refreshToken, filtrarPorPrincipal },
    });
  }

  /**
   * A qué Lista archiva sus correos esta cuenta (dentro de su propia Categoria por
   * email). `listaId: null` la vuelve a la Lista "Correos" compartida por defecto.
   */
  async actualizarLista(id: string, listaId: string | null): Promise<CuentaGmailPublica> {
    if (listaId) {
      const lista = await this.prisma.lista.findUnique({ where: { id: listaId } });
      if (!lista) {
        throw new NotFoundException(`Lista ${listaId} no encontrada`);
      }
    }
    try {
      return await this.prisma.cuentaGmail.update({
        where: { id },
        data: { listaId },
        select: { id: true, email: true, filtrarPorPrincipal: true, listaId: true, createdAt: true },
      });
    } catch {
      throw new NotFoundException(`Cuenta de Gmail ${id} no encontrada`);
    }
  }

  async eliminar(id: string): Promise<void> {
    try {
      await this.prisma.cuentaGmail.delete({ where: { id } });
    } catch {
      throw new NotFoundException(`Cuenta de Gmail ${id} no encontrada`);
    }
  }
}
