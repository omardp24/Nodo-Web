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

// gemini-2.5-flash-lite ya no está disponible para cuentas nuevas de Google AI Studio (404 al llamarlo);
// 3.5-flash-lite es el reemplazo recomendado por Google.
const MODELO = 'gemini-3.5-flash-lite';

/**
 * Offset UTC (en minutos) de una zona horaria IANA en un instante dado. Negativo
 * si la zona está detrás de UTC (ej. America/Caracas ⇒ -240). Usa Intl en vez de
 * una tabla propia porque así resuelve automáticamente el horario de verano.
 */
function offsetMinutos(fecha: Date, zonaHoraria: string): number {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: zonaHoraria,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
    .formatToParts(fecha)
    .reduce<Record<string, string>>((acc, p) => {
      if (p.type !== 'literal') acc[p.type] = p.value;
      return acc;
    }, {});
  const comoUTC = Date.UTC(
    Number(partes.year),
    Number(partes.month) - 1,
    Number(partes.day),
    Number(partes.hour),
    Number(partes.minute),
    Number(partes.second),
  );
  return Math.round((comoUTC - fecha.getTime()) / 60_000);
}

function formatoOffset(minutos: number): string {
  const signo = minutos < 0 ? '-' : '+';
  const abs = Math.abs(minutos);
  return `${signo}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/**
 * "Ahora" como ISO 8601 CON el offset real de la zona horaria del usuario (ej.
 * "2026-09-09T13:47:32-04:00"), no en UTC. Si solo le diéramos a Gemini la hora
 * en UTC (new Date().toISOString(), que siempre termina en "Z"), el modelo no
 * tiene forma de saber que "4 de la tarde" es hora LOCAL del usuario — resuelve
 * la hora relativa en el mismo frame que el timestamp que le dimos (UTC) y el
 * resultado queda corrido por el offset del usuario al mostrarlo localmente
 * (así se descubrió este bug: "4pm" en UTC-4 se mostraba como "12:00").
 */
function ahoraConOffset(zonaHoraria?: string): string {
  const ahora = new Date();
  if (!zonaHoraria) return ahora.toISOString();
  try {
    const minutos = offsetMinutos(ahora, zonaHoraria);
    const partes = new Intl.DateTimeFormat('en-CA', {
      timeZone: zonaHoraria,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(ahora)
      .reduce<Record<string, string>>((acc, p) => {
        if (p.type !== 'literal') acc[p.type] = p.value;
        return acc;
      }, {});
    return `${partes.year}-${partes.month}-${partes.day}T${partes.hour}:${partes.minute}:${partes.second}${formatoOffset(minutos)}`;
  } catch {
    // Zona horaria inválida/desconocida — mejor UTC que reventar la petición.
    return ahora.toISOString();
  }
}

const ESQUEMA_CLASIFICACION_CORREO = {
  type: 'object',
  properties: {
    accionable: {
      type: 'boolean',
      description:
        'true si el correo describe una acción pendiente real para el destinatario (pagar algo, asistir a una cita, responder algo importante, completar un trámite, una fecha límite). false si es publicidad/marketing, un boletín o newsletter, una notificación puramente informativa, o la confirmación de algo que ya se completó sin nada pendiente por hacer.',
    },
  },
  required: ['accionable'],
};

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

  async interpretar(texto: string, zonaHoraria?: string): Promise<InterpretacionRecordatorio> {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'El asistente no está configurado (falta GEMINI_API_KEY en el servidor)',
      );
    }

    const ahora = ahoraConOffset(zonaHoraria);
    const response = await this.client.models.generateContent({
      model: MODELO,
      contents: texto,
      config: {
        systemInstruction: `Eres el asistente de una app de recordatorios personales llamada Nodo. La fecha y hora actual, en la zona horaria del usuario${zonaHoraria ? ` (${zonaHoraria})` : ''}, es ${ahora} — el offset al final (ej. "-04:00") es el de su zona horaria real, no UTC. El usuario te habla en español, por texto o por voz (puede tener errores de transcripción). Extrae los datos del recordatorio, resolviendo fechas y horas relativas ("mañana", "el viernes", "4 de la tarde", "en 2 horas") contra esa fecha/hora actual, y devolvé fechaLimite con ese MISMO offset (no en UTC/"Z"), salvo que el offset dado ya sea +00:00.`,
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

  /**
   * Decide si un correo describe una acción pendiente real (candidato a Recordatorio)
   * o si es publicidad/newsletter/informativo sin nada que hacer. Si el asistente no
   * está configurado o falla, se asume accionable por defecto para no perder correos
   * silenciosamente — el mismo criterio conservador que ya se usa en `interpretar`.
   */
  async esAccionable(asunto: string, snippet: string): Promise<boolean> {
    if (!this.client) {
      return true;
    }

    try {
      const response = await this.client.models.generateContent({
        model: MODELO,
        contents: `Asunto: ${asunto}\n\nFragmento: ${snippet}`,
        config: {
          systemInstruction:
            'Eres un clasificador de correos para una app de recordatorios personales. Dado el asunto y un fragmento de un correo, decide si representa una acción pendiente genuina para el destinatario (pagar, agendar, responder, completar un trámite, una fecha límite) o si es publicidad, un boletín, redes sociales, o una notificación puramente informativa sin nada pendiente. Ante la duda entre publicidad y acción real, prefiere clasificarlo como no accionable.',
          responseMimeType: 'application/json',
          responseSchema: ESQUEMA_CLASIFICACION_CORREO,
        },
      });

      const textoRespuesta = response.text;
      if (!textoRespuesta) {
        return true;
      }
      const resultado = JSON.parse(textoRespuesta) as { accionable: boolean };
      return resultado.accionable;
    } catch (error) {
      this.logger.warn(`No se pudo clasificar el correo "${asunto}", se trata como accionable por defecto`, error);
      return true;
    }
  }
}
