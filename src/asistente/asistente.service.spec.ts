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

  describe('clasificarCorreo', () => {
    const AHORA = new Date('2026-09-09T18:00:00.000Z');

    it('devuelve accionable=true por defecto (sin fecha) si falta GEMINI_API_KEY', async () => {
      delete process.env.GEMINI_API_KEY;
      service.onModuleInit();

      await expect(service.clasificarCorreo('Oferta especial', 'compra ahora', AHORA)).resolves.toEqual({
        accionable: true,
      });
      expect(generateContentMock).not.toHaveBeenCalled();
    });

    describe('con GEMINI_API_KEY configurada', () => {
      beforeEach(() => {
        process.env.GEMINI_API_KEY = 'test-key';
        service.onModuleInit();
      });

      it('devuelve accionable=false para un correo clasificado como no accionable', async () => {
        generateContentMock.mockResolvedValue({ text: JSON.stringify({ accionable: false }) });

        const resultado = await service.clasificarCorreo('50% de descuento hoy', 'no te lo pierdas', AHORA);

        expect(resultado).toEqual({ accionable: false });
        expect(generateContentMock).toHaveBeenCalledWith(
          expect.objectContaining({
            model: 'gemini-3.5-flash-lite',
            config: expect.objectContaining({ responseMimeType: 'application/json' }),
          }),
        );
      });

      it('devuelve accionable=true y la fechaLimite cuando el correo la menciona', async () => {
        generateContentMock.mockResolvedValue({
          text: JSON.stringify({ accionable: true, fechaLimite: '2026-09-10T09:00:00-04:00' }),
        });

        await expect(
          service.clasificarCorreo('Factura vencida', 'debes pagar antes de mañana 9am', AHORA, 'America/Caracas'),
        ).resolves.toEqual({ accionable: true, fechaLimite: '2026-09-10T09:00:00-04:00' });
      });

      it('devuelve el resumen junto con accionable', async () => {
        generateContentMock.mockResolvedValue({
          text: JSON.stringify({ accionable: true, resumen: 'Enviar el informe antes de mañana 9am' }),
        });

        await expect(service.clasificarCorreo('Atencion Omar', 'tienes hasta mañana 9am', AHORA)).resolves.toEqual({
          accionable: true,
          resumen: 'Enviar el informe antes de mañana 9am',
        });
      });

      it('resuelve la fecha relativa contra la fecha de RECEPCIÓN del correo, no contra "ahora"', async () => {
        generateContentMock.mockResolvedValue({ text: JSON.stringify({ accionable: true }) });

        await service.clasificarCorreo('Algo', 'algo', AHORA, 'America/Caracas');

        const llamada = generateContentMock.mock.calls[0][0];
        const instruccion: string = llamada.config.systemInstruction;
        // AHORA es 2026-09-09T18:00:00Z ⇒ 14:00 en America/Caracas (UTC-4).
        expect(instruccion).toContain('2026-09-09T14:00:00-04:00');
      });

      it('devuelve accionable=true por defecto si Gemini falla al clasificar', async () => {
        generateContentMock.mockRejectedValue(new Error('Gemini caído'));

        await expect(service.clasificarCorreo('Algo', 'algo', AHORA)).resolves.toEqual({ accionable: true });
      });

      it('devuelve accionable=true por defecto si Gemini no devuelve texto', async () => {
        generateContentMock.mockResolvedValue({ text: undefined });

        await expect(service.clasificarCorreo('Algo', 'algo', AHORA)).resolves.toEqual({ accionable: true });
      });
    });
  });
});
