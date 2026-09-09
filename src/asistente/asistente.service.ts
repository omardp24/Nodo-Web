import {
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';

export interface InterpretacionRecordatorio {
  titulo: string;
  descripcion?: string;
  fechaLimite?: string;
  prioridad?: 'BAJA' | 'MEDIA' | 'ALTA';
  monto?: number;
  banco?: string;
}

const MODELO = 'claude-haiku-4-5-20251001';

const HERRAMIENTA_EXTRAER: Anthropic.Tool = {
  name: 'extraer_recordatorio',
  description:
    'Extrae los datos estructurados de un recordatorio a partir de una instrucción en lenguaje natural en español.',
  input_schema: {
    type: 'object',
    properties: {
      titulo: {
        type: 'string',
        description:
          'Título corto y claro del recordatorio, sin las referencias de fecha/hora/monto (esas se extraen en sus propios campos).',
      },
      descripcion: {
        type: 'string',
        description: 'Detalles adicionales, si los hay. Omitir si no aportan nada más que el título.',
      },
      fechaLimite: {
        type: 'string',
        description:
          'Fecha y hora en formato ISO 8601 con offset, resuelta contra la fecha/hora actual dada. Omitir si el texto no menciona ninguna fecha ni hora.',
      },
      prioridad: {
        type: 'string',
        enum: ['BAJA', 'MEDIA', 'ALTA'],
        description: 'Solo si el texto sugiere urgencia de forma explícita; si no, omitir.',
      },
      monto: {
        type: 'number',
        description: 'Monto a pagar, solo si es un recordatorio de pago.',
      },
      banco: {
        type: 'string',
        description: 'Banco o entidad a la que se le paga, solo si es un recordatorio de pago y se menciona.',
      },
    },
    required: ['titulo'],
  },
};

@Injectable()
export class AsistenteService implements OnModuleInit {
  private readonly logger = new Logger(AsistenteService.name);
  private client: Anthropic | null = null;

  onModuleInit() {
    if (process.env.ANTHROPIC_API_KEY) {
      this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    } else {
      this.logger.warn('Asistente Vínculo deshabilitado: falta ANTHROPIC_API_KEY en .env');
    }
  }

  async interpretar(texto: string): Promise<InterpretacionRecordatorio> {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'El asistente no está configurado (falta ANTHROPIC_API_KEY en el servidor)',
      );
    }

    const ahora = new Date().toISOString();
    const response = await this.client.messages.create({
      model: MODELO,
      max_tokens: 1024,
      system: `Eres el asistente de una app de recordatorios personales llamada Nodo. La fecha y hora actual es ${ahora}. El usuario te habla en español, por texto o por voz (puede tener errores de transcripción). Extrae los datos del recordatorio con la herramienta extraer_recordatorio, resolviendo fechas relativas ("mañana", "el viernes", "en 2 horas") contra la fecha actual dada.`,
      tools: [HERRAMIENTA_EXTRAER],
      tool_choice: { type: 'tool', name: 'extraer_recordatorio' },
      messages: [{ role: 'user', content: texto }],
    });

    const usoDeHerramienta = response.content.find(
      (bloque): bloque is Anthropic.ToolUseBlock => bloque.type === 'tool_use',
    );
    if (!usoDeHerramienta) {
      throw new InternalServerErrorException('El asistente no devolvió una respuesta interpretable');
    }

    return usoDeHerramienta.input as InterpretacionRecordatorio;
  }
}
