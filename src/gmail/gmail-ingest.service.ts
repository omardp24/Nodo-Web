import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { RecordatoriosService } from '../recordatorios/recordatorios.service.js';
import { GmailApiService } from './gmail-api.service.js';
import { GmailAccountsService } from './gmail-accounts.service.js';
import { AsistenteService } from '../asistente/asistente.service.js';
import type { CuentaGmail } from '../generated/prisma/client.js';

const LABEL_PROCESADO = 'Recordatorio-creado';
const LISTA_CORREOS = 'Correos';

/**
 * category:primary excluye las pestañas Promociones/Social/Actualizaciones de Gmail
 * (ahí caen casi todas las confirmaciones de pago, boletines y spam) — solo nos
 * interesan los correos "normales" de la bandeja Principal como candidatos a
 * recordatorio. Pero no todas las cuentas tienen esas pestañas habilitadas (varias
 * de Google Workspace las desactivan por política del admin) — para esas,
 * `cuenta.filtrarPorPrincipal` queda en false (detectado al conectarla, ver
 * GmailApiService.tieneCategoriaPrimaria) y se usa "in:inbox" a secas.
 */
function queryBase(cuenta: CuentaGmail): string {
  return cuenta.filtrarPorPrincipal ? 'in:inbox category:primary' : 'in:inbox';
}

/**
 * Zona horaria del usuario para resolver fechas relativas mencionadas en un correo
 * ("mañana", "el viernes") — a diferencia de Vínculo, la ingesta corre en un cron
 * sin request HTTP de por medio, así que no hay forma de leerla del navegador.
 */
function zonaHorariaIngesta(): string | undefined {
  return process.env.GMAIL_ZONA_HORARIA;
}

/**
 * Ingesta multi-cuenta: procesa TODAS las cuentas de Gmail conectadas (tabla
 * `cuentas_gmail`, gestionada por `GmailAccountsService`/`GmailAuthController`),
 * no solo una. Cada cuenta se etiqueta, deduplica y clasifica de forma
 * independiente, y cae en su propia Categoria (una por cuenta, nombrada con
 * su email) dentro de la Lista "Correos" — así se distingue de un vistazo
 * qué recordatorio vino de cuál cuenta (ej. personal vs. corporativa).
 */
@Injectable()
export class GmailIngestService implements OnModuleInit {
  private readonly logger = new Logger(GmailIngestService.name);
  private habilitado = false;
  private readonly listaCorreosId = new Map<string, string>(); // clave fija 'lista', cacheada una sola vez
  private readonly labelIdPorCuenta = new Map<string, string>();
  private readonly categoriaIdPorCuenta = new Map<string, string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly recordatorios: RecordatoriosService,
    private readonly gmailApi: GmailApiService,
    private readonly cuentasGmail: GmailAccountsService,
    private readonly asistente: AsistenteService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.habilitado = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
    if (!this.habilitado) {
      this.logger.warn('Ingesta de Gmail deshabilitada: faltan GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET en .env');
      return;
    }
    // GOOGLE_REFRESH_TOKEN es el mecanismo legacy de una sola cuenta (previo al soporte
    // multi-cuenta) — si sigue presente en .env, migramos esa cuenta a la tabla
    // `cuentas_gmail` para que quede en pie de igualdad con las conectadas por /auth/gmail.
    // Es idempotente (upsert por email), así que no molesta dejarlo corriendo en cada arranque.
    if (process.env.GOOGLE_REFRESH_TOKEN) {
      await this.migrarCuentaLegacyDesdeEnv(process.env.GOOGLE_REFRESH_TOKEN);
    }
  }

  private async migrarCuentaLegacyDesdeEnv(refreshToken: string): Promise<void> {
    try {
      const accessToken = await this.gmailApi.getAccessToken(refreshToken);
      const email = await this.gmailApi.getUserEmail(accessToken);
      const filtrarPorPrincipal = await this.gmailApi.tieneCategoriaPrimaria(refreshToken);
      await this.cuentasGmail.guardar(email, refreshToken, filtrarPorPrincipal);
      this.logger.log(`Cuenta heredada de GOOGLE_REFRESH_TOKEN migrada a la tabla de cuentas: ${email}`);
    } catch {
      // Causa más probable: ese refresh_token se emitió con el scope viejo
      // (solo gmail.modify, sin email/openid), así que Google rechaza identificar
      // la cuenta — no es un error real, hace falta reautorizar una vez.
      this.logger.warn(
        'No se pudo migrar automáticamente el GOOGLE_REFRESH_TOKEN heredado (probablemente le falta el ' +
          'scope de email, agregado junto con el soporte multi-cuenta). Volvé a abrir /auth/gmail en el ' +
          'navegador para reconectar esa cuenta — quedará guardada en la base de datos igual que cualquier otra.',
      );
    }
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async procesarCorreosNuevos(): Promise<void> {
    if (!this.habilitado) {
      return;
    }
    let cuentas: CuentaGmail[];
    try {
      cuentas = await this.cuentasGmail.listar();
    } catch (error) {
      this.logger.error('Falló el ciclo de ingesta de Gmail (no se pudieron listar las cuentas conectadas)', error);
      return;
    }
    for (const cuenta of cuentas) {
      try {
        await this.procesarCuenta(cuenta);
      } catch (error) {
        this.logger.error(`Falló la ingesta de Gmail para la cuenta ${cuenta.email}`, error);
      }
    }
  }

  private async procesarCuenta(cuenta: CuentaGmail): Promise<void> {
    const labelId = await this.getLabelId(cuenta);
    const ids = await this.gmailApi.listMessageIds(
      cuenta.refreshToken,
      `${queryBase(cuenta)} -label:${LABEL_PROCESADO}`,
    );
    if (ids.length === 0) {
      return;
    }
    this.logger.log(`Procesando ${ids.length} correo(s) nuevo(s) de ${cuenta.email}`);

    const categoriaId = await this.getCategoriaId(cuenta);
    for (const id of ids) {
      await this.crearRecordatorioDesdeCorreo(cuenta, id, categoriaId, labelId);
    }
  }

  private async crearRecordatorioDesdeCorreo(
    cuenta: CuentaGmail,
    messageId: string,
    categoriaId: string,
    labelId: string,
  ): Promise<void> {
    const message = await this.gmailApi.getMessage(cuenta.refreshToken, messageId);
    const asunto =
      message.payload.headers.find((h) => h.name === 'Subject')?.value ?? '(sin asunto)';

    const fechaRecepcion = new Date(Number(message.internalDate));
    const { accionable, fechaLimite } = await this.asistente.clasificarCorreo(
      asunto,
      message.snippet,
      fechaRecepcion,
      zonaHorariaIngesta(),
    );
    if (accionable) {
      await this.recordatorios.create({
        titulo: asunto.slice(0, 200),
        descripcion: message.snippet,
        origen: 'CORREO',
        categoriaId,
        ...(fechaLimite ? { fechaLimite } : {}),
      });
    } else {
      this.logger.log(`Correo descartado (no requiere acción, ${cuenta.email}): ${asunto}`);
    }
    // Se marca como procesado en ambos casos, para no volver a evaluarlo en el próximo ciclo.
    await this.gmailApi.addLabel(cuenta.refreshToken, messageId, labelId);
  }

  private async getLabelId(cuenta: CuentaGmail): Promise<string> {
    const cacheado = this.labelIdPorCuenta.get(cuenta.email);
    if (cacheado) {
      return cacheado;
    }
    const { id, created } = await this.gmailApi.getOrCreateLabelId(cuenta.refreshToken, LABEL_PROCESADO);
    this.labelIdPorCuenta.set(cuenta.email, id);
    if (created) {
      // Primera activación de ESTA cuenta: el label no existía todavía en ella, así
      // que marcamos TODO lo que ya está en su bandeja como "ya visto" sin crear
      // recordatorios — de lo contrario el próximo ciclo intentaría convertir el
      // historial completo de esa cuenta en recordatorios.
      await this.marcarInboxExistenteComoProcesado(cuenta, id);
    }
    return id;
  }

  private async marcarInboxExistenteComoProcesado(cuenta: CuentaGmail, labelId: string): Promise<void> {
    this.logger.log(
      `Primera activación para ${cuenta.email}: marcando su inbox existente como ya procesado (sin crear recordatorios)...`,
    );
    const ids = await this.gmailApi.listAllMessageIds(
      cuenta.refreshToken,
      `${queryBase(cuenta)} -label:${LABEL_PROCESADO}`,
    );
    if (ids.length > 0) {
      await this.gmailApi.batchAddLabel(cuenta.refreshToken, ids, labelId);
    }
    this.logger.log(`Se marcaron ${ids.length} correo(s) existentes de ${cuenta.email} como ya procesados.`);
  }

  private async getListaCorreosId(): Promise<string> {
    const cacheado = this.listaCorreosId.get('lista');
    if (cacheado) {
      return cacheado;
    }
    let lista = await this.prisma.lista.findFirst({ where: { nombre: LISTA_CORREOS } });
    if (!lista) {
      lista = await this.prisma.lista.create({ data: { nombre: LISTA_CORREOS } });
    }
    this.listaCorreosId.set('lista', lista.id);
    return lista.id;
  }

  /** Una Categoria por cuenta (nombrada con su email) dentro de la Lista "Correos". */
  private async getCategoriaId(cuenta: CuentaGmail): Promise<string> {
    const cacheado = this.categoriaIdPorCuenta.get(cuenta.email);
    if (cacheado) {
      return cacheado;
    }
    const listaId = await this.getListaCorreosId();
    let categoria = await this.prisma.categoria.findFirst({
      where: { nombre: cuenta.email, listaId },
    });
    if (!categoria) {
      categoria = await this.prisma.categoria.create({
        data: { nombre: cuenta.email, listaId },
      });
    }
    this.categoriaIdPorCuenta.set(cuenta.email, categoria.id);
    return categoria.id;
  }
}
