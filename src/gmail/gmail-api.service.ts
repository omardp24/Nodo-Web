import { Injectable, Logger } from '@nestjs/common';

interface GmailMessageHeader {
  name: string;
  value: string;
}

export interface GmailMessage {
  id: string;
  snippet: string;
  payload: { headers: GmailMessageHeader[] };
}

/**
 * Cliente de la API de Gmail. Soporta múltiples cuentas: el `refreshToken` de cada
 * cuenta se pasa explícitamente en cada llamada (no vive en una sola variable de
 * instancia) y el access token de corta duración que genera se cachea en un Map
 * indexado por refreshToken, para no pedir uno nuevo en cada mensaje procesado.
 */
@Injectable()
export class GmailApiService {
  private readonly logger = new Logger(GmailApiService.name);
  private readonly accessTokenCache = new Map<string, { token: string; expiresAt: number }>();

  private get clientId() {
    return process.env.GOOGLE_CLIENT_ID!;
  }
  private get clientSecret() {
    return process.env.GOOGLE_CLIENT_SECRET!;
  }
  private get redirectUri() {
    return process.env.GOOGLE_REDIRECT_URI!;
  }

  getAuthUrl(): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
      scope: 'https://www.googleapis.com/auth/gmail.modify openid email',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  async exchangeCodeForTokens(code: string): Promise<{ refresh_token?: string; access_token: string }> {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: this.redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!res.ok) {
      throw new Error(`Error intercambiando code por tokens: ${res.status} ${await res.text()}`);
    }
    return res.json();
  }

  /** Identifica a qué cuenta de Google pertenece un access token recién emitido. */
  async getUserEmail(accessToken: string): Promise<string> {
    const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new Error(`Error obteniendo el email de la cuenta: ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    return data.email;
  }

  /** Público porque `GmailIngestService` también lo usa para migrar el refresh_token heredado de .env. */
  async getAccessToken(refreshToken: string): Promise<string> {
    const cached = this.accessTokenCache.get(refreshToken);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.token;
    }
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    if (!res.ok) {
      throw new Error(`Error refrescando access token: ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    this.accessTokenCache.set(refreshToken, {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in - 60) * 1000,
    });
    return data.access_token;
  }

  private async gmailFetch(refreshToken: string, path: string, init?: RequestInit) {
    const token = await this.getAccessToken(refreshToken);
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
      ...init,
      headers: { ...init?.headers, Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(`Gmail API error en ${path}: ${res.status} ${await res.text()}`);
    }
    // batchModify (y otros endpoints de escritura) devuelven 200/204 con cuerpo vacío.
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  }

  /**
   * Detecta si "category:primary" (pestaña Principal) aplica a esta cuenta. Muchas
   * cuentas de Google Workspace tienen las pestañas del inbox deshabilitadas por el
   * administrador, y ahí ese operador no devuelve NUNCA resultados aunque el inbox
   * tenga correos — usarlo igual dejaría la ingesta silenciosamente vacía para
   * siempre. Se llama una sola vez, al conectar la cuenta.
   */
  async tieneCategoriaPrimaria(refreshToken: string): Promise<boolean> {
    const [conCategoria, sinCategoria] = await Promise.all([
      this.listMessageIds(refreshToken, 'in:inbox category:primary'),
      this.listMessageIds(refreshToken, 'in:inbox'),
    ]);
    return !(sinCategoria.length > 0 && conCategoria.length === 0);
  }

  /** Trae hasta 25 ids — para el ciclo normal de polling (siempre debería haber pocos). */
  async listMessageIds(refreshToken: string, query: string): Promise<string[]> {
    const data = await this.gmailFetch(refreshToken, `/messages?q=${encodeURIComponent(query)}&maxResults=25`);
    return (data.messages ?? []).map((m: { id: string }) => m.id);
  }

  /** Pagina hasta traer TODOS los ids que matchean — usado solo para el barrido inicial. */
  async listAllMessageIds(refreshToken: string, query: string): Promise<string[]> {
    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({ q: query, maxResults: '500' });
      if (pageToken) {
        params.set('pageToken', pageToken);
      }
      const data = await this.gmailFetch(refreshToken, `/messages?${params.toString()}`);
      ids.push(...(data.messages ?? []).map((m: { id: string }) => m.id));
      pageToken = data.nextPageToken;
    } while (pageToken);
    return ids;
  }

  async getMessage(refreshToken: string, id: string): Promise<GmailMessage> {
    return this.gmailFetch(refreshToken, `/messages/${id}?format=metadata&metadataHeaders=Subject`);
  }

  async getOrCreateLabelId(refreshToken: string, labelName: string): Promise<{ id: string; created: boolean }> {
    const data = await this.gmailFetch(refreshToken, '/labels');
    const existing = (data.labels ?? []).find((l: { name: string; id: string }) => l.name === labelName);
    if (existing) {
      return { id: existing.id, created: false };
    }
    this.logger.log(`Creando label de Gmail "${labelName}"`);
    const created = await this.gmailFetch(refreshToken, '/labels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: labelName,
        labelListVisibility: 'labelHide',
        messageListVisibility: 'hide',
      }),
    });
    return { id: created.id, created: true };
  }

  async addLabel(refreshToken: string, messageId: string, labelId: string): Promise<void> {
    await this.gmailFetch(refreshToken, `/messages/${messageId}/modify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ addLabelIds: [labelId] }),
    });
  }

  /** Etiqueta hasta 1000 mensajes por llamada (límite de la API de Gmail). */
  async batchAddLabel(refreshToken: string, messageIds: string[], labelId: string): Promise<void> {
    for (let i = 0; i < messageIds.length; i += 1000) {
      const chunk = messageIds.slice(i, i + 1000);
      await this.gmailFetch(refreshToken, '/messages/batchModify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: chunk, addLabelIds: [labelId] }),
      });
    }
  }
}
