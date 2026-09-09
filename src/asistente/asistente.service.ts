import {
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';

export interface InterpretacionRecordatorio {
  titulo: string;
  descripcion?: string;
  fechaLimite?: string;
  prioridad?: 'BAJA' | 'MEDIA' | 'ALTA';
  monto?: number;
  banco?: string;
}

const MODELO = 'gemini-2.5-flash-lite';

const ESQUEMA_RECORDATORIO = {
  type: 'object',
  properties: {
    titulo: {
      type: 'string',
      description:
        'Título corto y claro del recordatorio, sin las referencias de fecha/hora/monto (esas van en sus propios campos).',
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
};

@Injectable()
export class AsistenteService implements OnModuleInit {
  private readonly logger = new Logger(AsistenteService.name);
  private client: GoogleGenAI | null = null;

  onModuleInit() {
    if (process.env.GEMINI_API_KEY) {
      this.client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    } else {
      this.logger.warn('Asistente Vínculo deshabilitado: falta GEMINI_API_KEY en .env');
    }
  }

  async interpretar(texto: string): Promise<InterpretacionRecordatorio> {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'El asistente no está configurado (falta GEMINI_API_KEY en el servidor)',
      );
    }

    const ahora = new Date().toISOString();
    const response = await this.client.models.generateContent({
      model: MODELO,
      contents: texto,
      config: {
        systemInstruction: `Eres el asistente de una app de recordatorios personales llamada Nodo. La fecha y hora actual es ${ahora}. El usuario te habla en español, por texto o por voz (puede tener errores de transcripción). Extrae los datos del recordatorio, resolviendo fechas relativas ("mañana", "el viernes", "en 2 horas") contra la fecha actual dada.`,
        responseMimeType: 'application/json',
        responseSchema: ESQUEMA_RECORDATORIO,
      },
    });

    const textoRespuesta = response.text;
    if (!textoRespuesta) {
      throw new InternalServerErrorException('El asistente no devolvió una respuesta interpretable');
    }

    try {
      return JSON.parse(textoRespuesta) as InterpretacionRecordatorio;
    } catch {
      throw new InternalServerErrorException('El asistente no devolvió una respuesta interpretable');
    }
  }
}
