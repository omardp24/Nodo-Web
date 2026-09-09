import { ServiceUnavailableException, InternalServerErrorException } from '@nestjs/common';
import { AsistenteService } from './asistente.service.js';

const { generateContentMock, GoogleGenAIMock } = vi.hoisted(() => {
  const generateContentMock = vi.fn();
  function GoogleGenAIMock() {
    return { models: { generateContent: generateContentMock } };
  }
  return { generateContentMock, GoogleGenAIMock: vi.fn(GoogleGenAIMock) };
});

vi.mock('@google/genai', () => ({
  GoogleGenAI: GoogleGenAIMock,
}));

describe('AsistenteService', () => {
  let service: AsistenteService;
  const ENV_ORIGINAL = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ENV_ORIGINAL };
    service = new AsistenteService();
  });

  it('lanza ServiceUnavailableException si falta GEMINI_API_KEY', async () => {
    delete process.env.GEMINI_API_KEY;
    service.onModuleInit();

    await expect(service.interpretar('pagar la luz mañana')).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(GoogleGenAIMock).not.toHaveBeenCalled();
  });

  describe('con GEMINI_API_KEY configurada', () => {
    beforeEach(() => {
      process.env.GEMINI_API_KEY = 'test-key';
      service.onModuleInit();
    });

    it('devuelve los datos extraídos del JSON de Gemini', async () => {
      generateContentMock.mockResolvedValue({
        text: JSON.stringify({
          titulo: 'Pagar la luz',
          fechaLimite: '2026-09-10T09:00:00.000Z',
          monto: 45,
          banco: 'Banesco',
        }),
      });

      const resultado = await service.interpretar('pagar la luz mañana en el Banesco, son 45');

      expect(resultado).toEqual({
        titulo: 'Pagar la luz',
        fechaLimite: '2026-09-10T09:00:00.000Z',
        monto: 45,
        banco: 'Banesco',
      });
      expect(generateContentMock).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gemini-3.5-flash-lite',
          contents: 'pagar la luz mañana en el Banesco, son 45',
          config: expect.objectContaining({
            responseMimeType: 'application/json',
          }),
        }),
      );
    });

    it('le pasa a Gemini la hora actual con el offset de la zona horaria dada, no en UTC', async () => {
      generateContentMock.mockResolvedValue({ text: JSON.stringify({ titulo: 'Ir al odontólogo' }) });

      await service.interpretar('el viernes a las 4 de la tarde', 'America/Caracas');

      const llamada = generateContentMock.mock.calls[0][0];
      const instruccion: string = llamada.config.systemInstruction;
      // America/Caracas es UTC-4 todo el año (sin horario de verano) — el offset
      // siempre debe aparecer como -04:00, nunca "Z" (UTC), en la instrucción.
      expect(instruccion).toContain('America/Caracas');
      expect(instruccion).toMatch(/-04:00/);
      expect(instruccion).not.toMatch(/\dZ\b/);
    });

    it('sin zonaHoraria, cae de vuelta a UTC ("Z") en vez de fallar', async () => {
      generateContentMock.mockResolvedValue({ text: JSON.stringify({ titulo: 'Algo' }) });

      await service.interpretar('mañana');

      const llamada = generateContentMock.mock.calls[0][0];
      const instruccion: string = llamada.config.systemInstruction;
      expect(instruccion).toMatch(/Z\b/);
    });

    it('lanza InternalServerErrorException si Gemini no devuelve texto', async () => {
      generateContentMock.mockResolvedValue({ text: undefined });

      await expect(service.interpretar('algo')).rejects.toThrow(InternalServerErrorException);
    });

    it('lanza InternalServerErrorException si el texto no es JSON válido', async () => {
      generateContentMock.mockResolvedValue({ text: 'no soy json' });

      await expect(service.interpretar('algo')).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('esAccionable', () => {
    it('devuelve true (accionable por defecto) si falta GEMINI_API_KEY', async () => {
      delete process.env.GEMINI_API_KEY;
      service.onModuleInit();

      await expect(service.esAccionable('Oferta especial', 'compra ahora')).resolves.toBe(true);
      expect(generateContentMock).not.toHaveBeenCalled();
    });

    describe('con GEMINI_API_KEY configurada', () => {
      beforeEach(() => {
        process.env.GEMINI_API_KEY = 'test-key';
        service.onModuleInit();
      });

      it('devuelve false para un correo clasificado como no accionable', async () => {
        generateContentMock.mockResolvedValue({ text: JSON.stringify({ accionable: false }) });

        const resultado = await service.esAccionable('50% de descuento hoy', 'no te lo pierdas');

        expect(resultado).toBe(false);
        expect(generateContentMock).toHaveBeenCalledWith(
          expect.objectContaining({
            model: 'gemini-3.5-flash-lite',
            config: expect.objectContaining({ responseMimeType: 'application/json' }),
          }),
        );
      });

      it('devuelve true para un correo clasificado como accionable', async () => {
        generateContentMock.mockResolvedValue({ text: JSON.stringify({ accionable: true }) });

        await expect(service.esAccionable('Factura vencida', 'debes pagar antes del viernes')).resolves.toBe(
          true,
        );
      });

      it('devuelve true por defecto si Gemini falla al clasificar', async () => {
        generateContentMock.mockRejectedValue(new Error('Gemini caído'));

        await expect(service.esAccionable('Algo', 'algo')).resolves.toBe(true);
      });

      it('devuelve true por defecto si Gemini no devuelve texto', async () => {
        generateContentMock.mockResolvedValue({ text: undefined });

        await expect(service.esAccionable('Algo', 'algo')).resolves.toBe(true);
      });
    });
  });
});
