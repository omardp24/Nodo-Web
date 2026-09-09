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
          model: 'gemini-2.5-flash-lite',
          contents: 'pagar la luz mañana en el Banesco, son 45',
          config: expect.objectContaining({
            responseMimeType: 'application/json',
          }),
        }),
      );
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
});
