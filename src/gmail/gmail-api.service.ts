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

@Injectable()
export class GmailApiService {
  private readonly logger = new Logger(GmailApiService.name);
  private accessToken: string | null = null;
  private accessTokenExpiresAt = 0;

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
      scope: 'https://www.googleapis.com/auth/gmail.modify',
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

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.accessTokenExpiresAt) {
      return this.accessToken;
    }
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: process.env.GOOGLE_REFRESH_TOKEN!,
        grant_type: 'refresh_token',
      }),
    });
    if (!res.ok) {
      throw new Error(`Error refrescando access token: ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    this.accessToken = data.access_token;
    this.accessTokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
    return this.accessToken!;
  }

  private async gmailFetch(path: string, init?: RequestInit) {
    const token = await this.getAccessToken();
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

  /** Trae hasta 25 ids — para el ciclo normal de polling (siempre debería haber pocos). */
  async listMessageIds(query: string): Promise<string[]> {
    const data = await this.gmailFetch(`/messages?q=${encodeURIComponent(query)}&maxResults=25`);
    return (data.messages ?? []).map((m: { id: string }) => m.id);
  }

  /** Pagina hasta traer TODOS los ids que matchean — usado solo para el barrido inicial. */
  async listAllMessageIds(query: string): Promise<string[]> {
    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({ q: query, maxResults: '500' });
      if (pageToken) {
        params.set('pageToken', pageToken);
      }
      const data = await this.gmailFetch(`/messages?${params.toString()}`);
      ids.push(...(data.messages ?? []).map((m: { id: string }) => m.id));
      pageToken = data.nextPageToken;
    } while (pageToken);
    return ids;
  }

  async getMessage(id: string): Promise<GmailMessage> {
    return this.gmailFetch(`/messages/${id}?format=metadata&metadataHeaders=Subject`);
  }

  async getOrCreateLabelId(labelName: string): Promise<{ id: string; created: boolean }> {
    const data = await this.gmailFetch('/labels');
    const existing = (data.labels ?? []).find((l: { name: string; id: string }) => l.name === labelName);
    if (existing) {
      return { id: existing.id, created: false };
    }
    this.logger.log(`Creando label de Gmail "${labelName}"`);
    const created = await this.gmailFetch('/labels', {
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

  async addLabel(messageId: string, labelId: string): Promise<void> {
    await this.gmailFetch(`/messages/${messageId}/modify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ addLabelIds: [labelId] }),
    });
  }

  /** Etiqueta hasta 1000 mensajes por llamada (límite de la API de Gmail). */
  async batchAddLabel(messageIds: string[], labelId: string): Promise<void> {
    for (let i = 0; i < messageIds.length; i += 1000) {
      const chunk = messageIds.slice(i, i + 1000);
      await this.gmailFetch('/messages/batchModify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: chunk, addLabelIds: [labelId] }),
      });
    }
  }
}
