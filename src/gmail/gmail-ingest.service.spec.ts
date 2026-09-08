import { Test, TestingModule } from '@nestjs/testing';
import { GmailIngestService } from './gmail-ingest.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RecordatoriosService } from '../recordatorios/recordatorios.service.js';
import { GmailApiService } from './gmail-api.service.js';

describe('GmailIngestService', () => {
  let service: GmailIngestService;

  const prisma = {
    lista: { findFirst: vi.fn(), create: vi.fn() },
    categoria: { findFirst: vi.fn(), create: vi.fn() },
  };
  const recordatorios = { create: vi.fn() };
  const gmailApi = {
    listMessageIds: vi.fn(),
    listAllMessageIds: vi.fn(),
    getMessage: vi.fn(),
    getOrCreateLabelId: vi.fn(),
    addLabel: vi.fn(),
    batchAddLabel: vi.fn(),
  };

  const ENV_ORIGINAL = { ...process.env };

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env = { ...ENV_ORIGINAL };
    // Por defecto simulamos que el label ya existía (no es la primera activación);
    // los tests que sí quieren probar el barrido inicial lo sobreescriben.
    gmailApi.getOrCreateLabelId.mockResolvedValue({ id: 'label-1', created: false });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GmailIngestService,
        { provide: PrismaService, useValue: prisma },
        { provide: RecordatoriosService, useValue: recordatorios },
        { provide: GmailApiService, useValue: gmailApi },
      ],
    }).compile();

    service = module.get(GmailIngestService);
  });

  it('no hace nada si faltan credenciales de Google en el entorno', async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_REFRESH_TOKEN;
    service.onModuleInit();

    await service.procesarCorreosNuevos();

    expect(gmailApi.listMessageIds).not.toHaveBeenCalled();
  });

  describe('con credenciales configuradas', () => {
    beforeEach(() => {
      process.env.GOOGLE_CLIENT_ID = 'client-id';
      process.env.GOOGLE_CLIENT_SECRET = 'client-secret';
      process.env.GOOGLE_REFRESH_TOKEN = 'refresh-token';
      service.onModuleInit();
    });

    it('en la primera activación marca el inbox existente como procesado sin crear recordatorios', async () => {
      gmailApi.getOrCreateLabelId.mockResolvedValue({ id: 'label-1', created: true });
      gmailApi.listAllMessageIds.mockResolvedValue(['viejo1', 'viejo2', 'viejo3']);
      gmailApi.listMessageIds.mockResolvedValue([]);

      await service.procesarCorreosNuevos();

      expect(gmailApi.listAllMessageIds).toHaveBeenCalledWith(
        'in:inbox category:primary -label:Recordatorio-creado',
      );
      expect(gmailApi.batchAddLabel).toHaveBeenCalledWith(['viejo1', 'viejo2', 'viejo3'], 'label-1');
      expect(recordatorios.create).not.toHaveBeenCalled();
    });

    it('no hace nada si no hay mensajes nuevos', async () => {
      gmailApi.listMessageIds.mockResolvedValue([]);

      await service.procesarCorreosNuevos();

      expect(recordatorios.create).not.toHaveBeenCalled();
    });

    it('solo consulta la bandeja Principal (category:primary) y excluye lo ya etiquetado', async () => {
      gmailApi.listMessageIds.mockResolvedValue([]);

      await service.procesarCorreosNuevos();

      expect(gmailApi.listMessageIds).toHaveBeenCalledWith(
        'in:inbox category:primary -label:Recordatorio-creado',
      );
    });

    it('crea la Lista/Categoria de correos solo la primera vez y crea un recordatorio por mensaje', async () => {
      gmailApi.listMessageIds.mockResolvedValue(['m1', 'm2']);
      gmailApi.getMessage.mockImplementation((id: string) => ({
        id,
        snippet: `snippet-${id}`,
        payload: { headers: [{ name: 'Subject', value: `Asunto ${id}` }] },
      }));
      prisma.lista.findFirst.mockResolvedValue(null);
      prisma.lista.create.mockResolvedValue({ id: 'lista-correos' });
      prisma.categoria.findFirst.mockResolvedValue(null);
      prisma.categoria.create.mockResolvedValue({ id: 'categoria-sin-clasificar' });
      recordatorios.create.mockResolvedValue({ id: 'r1' });

      await service.procesarCorreosNuevos();

      expect(prisma.lista.create).toHaveBeenCalledWith({ data: { nombre: 'Correos' } });
      expect(prisma.categoria.create).toHaveBeenCalledWith({
        data: { nombre: 'Sin clasificar', listaId: 'lista-correos' },
      });
      expect(recordatorios.create).toHaveBeenCalledTimes(2);
      expect(recordatorios.create).toHaveBeenCalledWith({
        titulo: 'Asunto m1',
        descripcion: 'snippet-m1',
        origen: 'CORREO',
        categoriaId: 'categoria-sin-clasificar',
      });
      expect(gmailApi.addLabel).toHaveBeenCalledWith('m1', 'label-1');
      expect(gmailApi.addLabel).toHaveBeenCalledWith('m2', 'label-1');

      // Segunda corrida: no debe volver a consultar/crear la Lista ni la Categoria (queda cacheada en memoria)
      gmailApi.listMessageIds.mockResolvedValue(['m3']);
      await service.procesarCorreosNuevos();
      expect(prisma.lista.findFirst).toHaveBeenCalledTimes(1);
      expect(prisma.categoria.findFirst).toHaveBeenCalledTimes(1);
    });

    it('reutiliza la Lista/Categoria existentes si ya existen', async () => {
      gmailApi.listMessageIds.mockResolvedValue(['m1']);
      gmailApi.getMessage.mockResolvedValue({
        id: 'm1',
        snippet: 'hola',
        payload: { headers: [{ name: 'Subject', value: 'Hola' }] },
      });
      prisma.lista.findFirst.mockResolvedValue({ id: 'lista-existente' });
      prisma.categoria.findFirst.mockResolvedValue({ id: 'categoria-existente' });

      await service.procesarCorreosNuevos();

      expect(prisma.lista.create).not.toHaveBeenCalled();
      expect(prisma.categoria.create).not.toHaveBeenCalled();
      expect(recordatorios.create).toHaveBeenCalledWith(
        expect.objectContaining({ categoriaId: 'categoria-existente' }),
      );
    });

    it('no propaga errores si falla la llamada a Gmail (loguea y sigue vivo)', async () => {
      gmailApi.getOrCreateLabelId.mockRejectedValue(new Error('Gmail caído'));

      await expect(service.procesarCorreosNuevos()).resolves.toBeUndefined();
    });
  });
});
