import { ServiceUnavailableException, InternalServerErrorException } from '@nestjs/common';
import { AsistenteService } from './asistente.service.js';

const { messagesCreateMock, AnthropicMock } = vi.hoisted(() => {
  const messagesCreateMock = vi.fn();
  function AnthropicMock() {
    return { messages: { create: messagesCreateMock } };
  }
  return { messagesCreateMock, AnthropicMock: vi.fn(AnthropicMock) };
});

vi.mock('@anthropic-ai/sdk', () => ({
  default: AnthropicMock,
}));

describe('AsistenteService', () => {
  let service: AsistenteService;
  const ENV_ORIGINAL = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ENV_ORIGINAL };
    service = new AsistenteService();
  });

  it('lanza ServiceUnavailableException si falta ANTHROPIC_API_KEY', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    service.onModuleInit();

    await expect(service.interpretar('pagar la luz mañana')).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(AnthropicMock).not.toHaveBeenCalled();
  });

  describe('con ANTHROPIC_API_KEY configurada', () => {
    beforeEach(() => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
      service.onModuleInit();
    });

    it('devuelve los datos extraídos del tool_use de Claude', async () => {
      messagesCreateMock.mockResolvedValue({
        content: [
          {
            type: 'tool_use',
            name: 'extraer_recordatorio',
            input: {
              titulo: 'Pagar la luz',
              fechaLimite: '2026-09-10T09:00:00.000Z',
              monto: 45,
              banco: 'Banesco',
            },
          },
        ],
      });

      const resultado = await service.interpretar('pagar la luz mañana en el Banesco, son 45');

      expect(resultado).toEqual({
        titulo: 'Pagar la luz',
        fechaLimite: '2026-09-10T09:00:00.000Z',
        monto: 45,
        banco: 'Banesco',
      });
      expect(messagesCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tool_choice: { type: 'tool', name: 'extraer_recordatorio' },
          messages: [{ role: 'user', content: 'pagar la luz mañana en el Banesco, son 45' }],
        }),
      );
    });

    it('lanza InternalServerErrorException si Claude no devuelve tool_use', async () => {
      messagesCreateMock.mockResolvedValue({ content: [{ type: 'text', text: 'no puedo ayudar' }] });

      await expect(service.interpretar('algo')).rejects.toThrow(InternalServerErrorException);
    });
  });
});
