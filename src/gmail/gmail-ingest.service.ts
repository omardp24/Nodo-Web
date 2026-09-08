import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { RecordatoriosService } from '../recordatorios/recordatorios.service.js';
import { GmailApiService } from './gmail-api.service.js';

const LABEL_PROCESADO = 'Recordatorio-creado';
const LISTA_CORREOS = 'Correos';
const CATEGORIA_SIN_CLASIFICAR = 'Sin clasificar';
// category:primary excluye las pestañas Promociones/Social/Actualizaciones de Gmail
// (ahí caen casi todas las confirmaciones de pago, boletines y spam) — solo nos
// interesan los correos "normales" de la bandeja Principal como candidatos a recordatorio.
const QUERY_BASE = 'in:inbox category:primary';

@Injectable()
export class GmailIngestService implements OnModuleInit {
  private readonly logger = new Logger(GmailIngestService.name);
  private habilitado = false;
  private labelId: string | null = null;
  private categoriaCorreosId: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly recordatorios: RecordatoriosService,
    private readonly gmailApi: GmailApiService,
  ) {}

  onModuleInit() {
    this.habilitado = Boolean(
      process.env.GOOGLE_CLIENT_ID &&
        process.env.GOOGLE_CLIENT_SECRET &&
        process.env.GOOGLE_REFRESH_TOKEN,
    );
    if (!this.habilitado) {
      this.logger.warn(
        'Ingesta de Gmail deshabilitada: faltan GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/GOOGLE_REFRESH_TOKEN en .env',
      );
    }
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async procesarCorreosNuevos(): Promise<void> {
    if (!this.habilitado) {
      return;
    }
    try {
      const labelId = await this.getLabelId();
      const ids = await this.gmailApi.listMessageIds(`${QUERY_BASE} -label:${LABEL_PROCESADO}`);
      if (ids.length === 0) {
        return;
      }
      this.logger.log(`Procesando ${ids.length} correo(s) nuevo(s)`);

      const categoriaId = await this.getCategoriaCorreosId();
      for (const id of ids) {
        await this.crearRecordatorioDesdeCorreo(id, categoriaId, labelId);
      }
    } catch (error) {
      this.logger.error('Falló el ciclo de ingesta de Gmail', error);
    }
  }

  private async crearRecordatorioDesdeCorreo(
    messageId: string,
    categoriaId: string,
    labelId: string,
  ): Promise<void> {
    const message = await this.gmailApi.getMessage(messageId);
    const asunto =
      message.payload.headers.find((h) => h.name === 'Subject')?.value ?? '(sin asunto)';

    await this.recordatorios.create({
      titulo: asunto.slice(0, 200),
      descripcion: message.snippet,
      origen: 'CORREO',
      categoriaId,
    });
    await this.gmailApi.addLabel(messageId, labelId);
  }

  private async getLabelId(): Promise<string> {
    if (this.labelId) {
      return this.labelId;
    }
    const { id, created } = await this.gmailApi.getOrCreateLabelId(LABEL_PROCESADO);
    this.labelId = id;
    if (created) {
      // Primera activación: el label no existía, así que marcamos TODO lo que ya
      // está en la bandeja como "ya visto" sin crear recordatorios — de lo
      // contrario el próximo ciclo intentaría convertir el historial completo
      // del inbox en recordatorios.
      await this.marcarInboxExistenteComoProcesado(id);
    }
    return id;
  }

  private async marcarInboxExistenteComoProcesado(labelId: string): Promise<void> {
    this.logger.log('Primera activación: marcando el inbox existente como ya procesado (sin crear recordatorios)...');
    const ids = await this.gmailApi.listAllMessageIds(`${QUERY_BASE} -label:${LABEL_PROCESADO}`);
    if (ids.length > 0) {
      await this.gmailApi.batchAddLabel(ids, labelId);
    }
    this.logger.log(`Se marcaron ${ids.length} correo(s) existentes como ya procesados.`);
  }

  private async getCategoriaCorreosId(): Promise<string> {
    if (this.categoriaCorreosId) {
      return this.categoriaCorreosId;
    }
    let lista = await this.prisma.lista.findFirst({ where: { nombre: LISTA_CORREOS } });
    if (!lista) {
      lista = await this.prisma.lista.create({ data: { nombre: LISTA_CORREOS } });
    }
    let categoria = await this.prisma.categoria.findFirst({
      where: { nombre: CATEGORIA_SIN_CLASIFICAR, listaId: lista.id },
    });
    if (!categoria) {
      categoria = await this.prisma.categoria.create({
        data: { nombre: CATEGORIA_SIN_CLASIFICAR, listaId: lista.id },
      });
    }
    this.categoriaCorreosId = categoria.id;
    return categoria.id;
  }
}
