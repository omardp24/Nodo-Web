import { Test, TestingModule } from '@nestjs/testing';
import { GmailIngestService } from './gmail-ingest.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RecordatoriosService } from '../recordatorios/recordatorios.service.js';
import { GmailApiService } from './gmail-api.service.js';
import { GmailAccountsService } from './gmail-accounts.service.js';
import { AsistenteService } from '../asistente/asistente.service.js';

describe('GmailIngestService', () => {
  let service: GmailIngestService;

  const CUENTA1 = {
    id: 'cuenta-1',
    email: 'personal@gmail.com',
    refreshToken: 'refresh-1',
    filtrarPorPrincipal: true,
  };
  const CUENTA2 = {
    id: 'cuenta-2',
    email: 'trabajo@empresa.com',
    refreshToken: 'refresh-2',
    filtrarPorPrincipal: true,
  };

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
    getAccessToken: vi.fn(),
    getUserEmail: vi.fn(),
    tieneCategoriaPrimaria: vi.fn(),
  };
  const cuentasGmail = { listar: vi.fn(), guardar: vi.fn() };
  const asistente = { clasificarCorreo: vi.fn() };

  const ENV_ORIGINAL = { ...process.env };

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env = { ...ENV_ORIGINAL };
    delete process.env.GOOGLE_REFRESH_TOKEN;
    // Por defecto simulamos que el label ya existía (no es la primera activación);
    // los tests que sí quieren probar el barrido inicial lo sobreescriben.
    gmailApi.getOrCreateLabelId.mockResolvedValue({ id: 'label-1', created: false });
    // Por defecto todo correo se clasifica como accionable (sin fecha); los tests que
    // quieren probar el filtrado o la extracción de fecha lo sobreescriben.
    asistente.clasificarCorreo.mockResolvedValue({ accionable: true });
    cuentasGmail.listar.mockResolvedValue([]);
    gmailApi.tieneCategoriaPrimaria.mockResolvedValue(true);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GmailIngestService,
        { provide: PrismaService, useValue: prisma },
        { provide: RecordatoriosService, useValue: recordatorios },
        { provide: GmailApiService, useValue: gmailApi },
        { provide: GmailAccountsService, useValue: cuentasGmail },
        { provide: AsistenteService, useValue: asistente },
      ],
    }).compile();

    service = module.get(GmailIngestService);
  });

  it('no hace nada si faltan credenciales de Google en el entorno', async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    await service.onModuleInit();

    await service.procesarCorreosNuevos();

    expect(cuentasGmail.listar).not.toHaveBeenCalled();
  });

  describe('con credenciales configuradas', () => {
    beforeEach(async () => {
      process.env.GOOGLE_CLIENT_ID = 'client-id';
      process.env.GOOGLE_CLIENT_SECRET = 'client-secret';
      await service.onModuleInit();
    });

    it('migra GOOGLE_REFRESH_TOKEN (legacy) a la tabla de cuentas al arrancar', async () => {
      process.env.GOOGLE_REFRESH_TOKEN = 'refresh-legacy';
      gmailApi.getAccessToken.mockResolvedValue('access-legacy');
      gmailApi.getUserEmail.mockResolvedValue('legacy@gmail.com');
      gmailApi.tieneCategoriaPrimaria.mockResolvedValue(true);

      await service.onModuleInit();

      expect(gmailApi.getAccessToken).toHaveBeenCalledWith('refresh-legacy');
      expect(gmailApi.getUserEmail).toHaveBeenCalledWith('access-legacy');
      expect(cuentasGmail.guardar).toHaveBeenCalledWith('legacy@gmail.com', 'refresh-legacy', true);
    });

    it('no propaga el error si el token heredado ya no tiene el scope necesario para migrarse', async () => {
      process.env.GOOGLE_REFRESH_TOKEN = 'refresh-legacy';
      gmailApi.getAccessToken.mockResolvedValue('access-legacy');
      gmailApi.getUserEmail.mockRejectedValue(new Error('401 UNAUTHENTICATED'));

      await expect(service.onModuleInit()).resolves.toBeUndefined();
      expect(cuentasGmail.guardar).not.toHaveBeenCalled();
    });

    it('no hace nada si no hay cuentas conectadas', async () => {
      cuentasGmail.listar.mockResolvedValue([]);

      await service.procesarCorreosNuevos();

      expect(recordatorios.create).not.toHaveBeenCalled();
    });

    it('en la primera activación de una cuenta marca su inbox existente como procesado sin crear recordatorios', async () => {
      cuentasGmail.listar.mockResolvedValue([CUENTA1]);
      gmailApi.getOrCreateLabelId.mockResolvedValue({ id: 'label-1', created: true });
      gmailApi.listAllMessageIds.mockResolvedValue(['viejo1', 'viejo2', 'viejo3']);
      gmailApi.listMessageIds.mockResolvedValue([]);

      await service.procesarCorreosNuevos();

      expect(gmailApi.listAllMessageIds).toHaveBeenCalledWith(
        'refresh-1',
        'in:inbox category:primary -label:Recordatorio-creado',
      );
      expect(gmailApi.batchAddLabel).toHaveBeenCalledWith('refresh-1', ['viejo1', 'viejo2', 'viejo3'], 'label-1');
      expect(recordatorios.create).not.toHaveBeenCalled();
    });

    it('solo consulta la bandeja Principal (category:primary) y excluye lo ya etiquetado', async () => {
      cuentasGmail.listar.mockResolvedValue([CUENTA1]);
      gmailApi.listMessageIds.mockResolvedValue([]);

      await service.procesarCorreosNuevos();

      expect(gmailApi.listMessageIds).toHaveBeenCalledWith(
        'refresh-1',
        'in:inbox category:primary -label:Recordatorio-creado',
      );
    });

    it('usa "in:inbox" a secas si la cuenta no tiene pestañas de Gmail (filtrarPorPrincipal: false)', async () => {
      cuentasGmail.listar.mockResolvedValue([{ ...CUENTA1, filtrarPorPrincipal: false }]);
      gmailApi.listMessageIds.mockResolvedValue([]);

      await service.procesarCorreosNuevos();

      expect(gmailApi.listMessageIds).toHaveBeenCalledWith(
        'refresh-1',
        'in:inbox -label:Recordatorio-creado',
      );
    });

    it('crea la Lista/Categoria de correos solo la primera vez y crea un recordatorio por mensaje', async () => {
      cuentasGmail.listar.mockResolvedValue([CUENTA1]);
      gmailApi.listMessageIds.mockResolvedValue(['m1', 'm2']);
      gmailApi.getMessage.mockImplementation((_token: string, id: string) => ({
        id,
        snippet: `snippet-${id}`,
        internalDate: '1757462400000',
        payload: { headers: [{ name: 'Subject', value: `Asunto ${id}` }] },
      }));
      prisma.lista.findFirst.mockResolvedValue(null);
      prisma.lista.create.mockResolvedValue({ id: 'lista-correos' });
      prisma.categoria.findFirst.mockResolvedValue(null);
      prisma.categoria.create.mockResolvedValue({ id: 'categoria-personal' });
      recordatorios.create.mockResolvedValue({ id: 'r1' });

      await service.procesarCorreosNuevos();

      expect(prisma.lista.create).toHaveBeenCalledWith({ data: { nombre: 'Correos' } });
      expect(prisma.categoria.create).toHaveBeenCalledWith({
        data: { nombre: 'personal@gmail.com', listaId: 'lista-correos' },
      });
      expect(recordatorios.create).toHaveBeenCalledTimes(2);
      expect(recordatorios.create).toHaveBeenCalledWith({
        titulo: 'Asunto m1',
        descripcion: 'snippet-m1',
        origen: 'CORREO',
        categoriaId: 'categoria-personal',
      });
      expect(asistente.clasificarCorreo).toHaveBeenCalledWith(
        'Asunto m1',
        'snippet-m1',
        new Date(1757462400000),
        undefined,
      );
      expect(gmailApi.addLabel).toHaveBeenCalledWith('refresh-1', 'm1', 'label-1');
      expect(gmailApi.addLabel).toHaveBeenCalledWith('refresh-1', 'm2', 'label-1');

      // Segunda corrida: no debe volver a consultar/crear la Lista ni la Categoria (queda cacheada en memoria)
      gmailApi.listMessageIds.mockResolvedValue(['m3']);
      await service.procesarCorreosNuevos();
      expect(prisma.lista.findFirst).toHaveBeenCalledTimes(1);
      expect(prisma.categoria.findFirst).toHaveBeenCalledTimes(1);
    });

    it('reutiliza la Lista/Categoria existentes si ya existen', async () => {
      cuentasGmail.listar.mockResolvedValue([CUENTA1]);
      gmailApi.listMessageIds.mockResolvedValue(['m1']);
      gmailApi.getMessage.mockResolvedValue({
        id: 'm1',
        snippet: 'hola',
        internalDate: '1757462400000',
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

    it('procesa varias cuentas conectadas, cada una en su propia Categoria', async () => {
      cuentasGmail.listar.mockResolvedValue([CUENTA1, CUENTA2]);
      gmailApi.listMessageIds.mockImplementation((token: string) =>
        Promise.resolve(token === CUENTA1.refreshToken ? ['m-personal'] : ['m-trabajo']),
      );
      gmailApi.getMessage.mockImplementation((_token: string, id: string) => ({
        id,
        snippet: `snippet-${id}`,
        internalDate: '1757462400000',
        payload: { headers: [{ name: 'Subject', value: `Asunto ${id}` }] },
      }));
      prisma.lista.findFirst.mockResolvedValue({ id: 'lista-correos' });
      prisma.categoria.findFirst.mockImplementation((args: { where: { nombre: string } }) =>
        Promise.resolve({ id: `categoria-${args.where.nombre}` }),
      );

      await service.procesarCorreosNuevos();

      expect(recordatorios.create).toHaveBeenCalledWith(
        expect.objectContaining({ categoriaId: `categoria-${CUENTA1.email}` }),
      );
      expect(recordatorios.create).toHaveBeenCalledWith(
        expect.objectContaining({ categoriaId: `categoria-${CUENTA2.email}` }),
      );
    });

    it('descarta correos no accionables (publicidad/newsletter) pero los marca como procesados', async () => {
      cuentasGmail.listar.mockResolvedValue([CUENTA1]);
      gmailApi.listMessageIds.mockResolvedValue(['promo1', 'urgente1']);
      gmailApi.getMessage.mockImplementation((_token: string, id: string) => ({
        id,
        snippet: `snippet-${id}`,
        internalDate: '1757462400000',
        payload: { headers: [{ name: 'Subject', value: `Asunto ${id}` }] },
      }));
      prisma.lista.findFirst.mockResolvedValue({ id: 'lista-correos' });
      prisma.categoria.findFirst.mockResolvedValue({ id: 'categoria-personal' });
      asistente.clasificarCorreo.mockImplementation((asunto: string) =>
        Promise.resolve({ accionable: !asunto.includes('promo1') }),
      );

      await service.procesarCorreosNuevos();

      expect(recordatorios.create).toHaveBeenCalledTimes(1);
      expect(recordatorios.create).toHaveBeenCalledWith(
        expect.objectContaining({ titulo: 'Asunto urgente1' }),
      );
      expect(gmailApi.addLabel).toHaveBeenCalledWith('refresh-1', 'promo1', 'label-1');
      expect(gmailApi.addLabel).toHaveBeenCalledWith('refresh-1', 'urgente1', 'label-1');
    });

    it('incluye la fechaLimite devuelta por el asistente al crear el recordatorio', async () => {
      cuentasGmail.listar.mockResolvedValue([CUENTA1]);
      gmailApi.listMessageIds.mockResolvedValue(['m1']);
      gmailApi.getMessage.mockResolvedValue({
        id: 'm1',
        snippet: 'tienes hasta mañana 9am',
        internalDate: '1757462400000',
        payload: { headers: [{ name: 'Subject', value: 'Atencion' }] },
      });
      prisma.lista.findFirst.mockResolvedValue({ id: 'lista-correos' });
      prisma.categoria.findFirst.mockResolvedValue({ id: 'categoria-personal' });
      asistente.clasificarCorreo.mockResolvedValue({
        accionable: true,
        fechaLimite: '2026-09-10T09:00:00-04:00',
      });

      await service.procesarCorreosNuevos();

      expect(recordatorios.create).toHaveBeenCalledWith(
        expect.objectContaining({ fechaLimite: '2026-09-10T09:00:00-04:00' }),
      );
    });

    it('usa el resumen del asistente como descripción en vez del snippet crudo', async () => {
      cuentasGmail.listar.mockResolvedValue([CUENTA1]);
      gmailApi.listMessageIds.mockResolvedValue(['m1']);
      gmailApi.getMessage.mockResolvedValue({
        id: 'm1',
        snippet: 'snippet crudo del correo, largo y con ruido',
        internalDate: '1757462400000',
        payload: { headers: [{ name: 'Subject', value: 'Atencion' }] },
      });
      prisma.lista.findFirst.mockResolvedValue({ id: 'lista-correos' });
      prisma.categoria.findFirst.mockResolvedValue({ id: 'categoria-personal' });
      asistente.clasificarCorreo.mockResolvedValue({
        accionable: true,
        resumen: 'Enviar el informe antes de mañana 9am',
      });

      await service.procesarCorreosNuevos();

      expect(recordatorios.create).toHaveBeenCalledWith(
        expect.objectContaining({ descripcion: 'Enviar el informe antes de mañana 9am' }),
      );
    });

    it('usa el snippet como respaldo si el asistente no devuelve resumen', async () => {
      cuentasGmail.listar.mockResolvedValue([CUENTA1]);
      gmailApi.listMessageIds.mockResolvedValue(['m1']);
      gmailApi.getMessage.mockResolvedValue({
        id: 'm1',
        snippet: 'snippet crudo del correo',
        internalDate: '1757462400000',
        payload: { headers: [{ name: 'Subject', value: 'Atencion' }] },
      });
      prisma.lista.findFirst.mockResolvedValue({ id: 'lista-correos' });
      prisma.categoria.findFirst.mockResolvedValue({ id: 'categoria-personal' });
      asistente.clasificarCorreo.mockResolvedValue({ accionable: true });

      await service.procesarCorreosNuevos();

      expect(recordatorios.create).toHaveBeenCalledWith(
        expect.objectContaining({ descripcion: 'snippet crudo del correo' }),
      );
    });

    it('no propaga errores si falla la llamada a Gmail para una cuenta (loguea y sigue con las demás)', async () => {
      cuentasGmail.listar.mockResolvedValue([CUENTA1, CUENTA2]);
      gmailApi.getOrCreateLabelId.mockImplementation((token: string) =>
        token === CUENTA1.refreshToken
          ? Promise.reject(new Error('Gmail caído'))
          : Promise.resolve({ id: 'label-2', created: false }),
      );
      gmailApi.listMessageIds.mockResolvedValue([]);

      await expect(service.procesarCorreosNuevos()).resolves.toBeUndefined();
      expect(gmailApi.listMessageIds).toHaveBeenCalledWith(
        CUENTA2.refreshToken,
        expect.any(String),
      );
    });
  });
});
