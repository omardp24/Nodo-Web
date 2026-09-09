import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CuentaGmail } from '../generated/prisma/client.js';

@Injectable()
export class GmailAccountsService {
  constructor(private readonly prisma: PrismaService) {}

  listar(): Promise<CuentaGmail[]> {
    return this.prisma.cuentaGmail.findMany({ orderBy: { createdAt: 'asc' } });
  }

  /** Guarda (o actualiza el refresh_token de) una cuenta ya identificada por su email. */
  guardar(email: string, refreshToken: string): Promise<CuentaGmail> {
    return this.prisma.cuentaGmail.upsert({
      where: { email },
      update: { refreshToken },
      create: { email, refreshToken },
    });
  }
}
