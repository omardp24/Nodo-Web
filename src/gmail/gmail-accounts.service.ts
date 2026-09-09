import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CuentaGmail } from '../generated/prisma/client.js';

export interface CuentaGmailPublica {
  id: string;
  email: string;
  filtrarPorPrincipal: boolean;
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
      select: { id: true, email: true, filtrarPorPrincipal: true, createdAt: true },
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

  async eliminar(id: string): Promise<void> {
    try {
      await this.prisma.cuentaGmail.delete({ where: { id } });
    } catch {
      throw new NotFoundException(`Cuenta de Gmail ${id} no encontrada`);
    }
  }
}
