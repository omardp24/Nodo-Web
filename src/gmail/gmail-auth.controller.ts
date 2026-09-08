import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator.js';
import { GmailApiService } from './gmail-api.service.js';

/**
 * Flujo de consentimiento OAuth de Google, de un solo uso, para obtener el
 * refresh_token que luego se guarda a mano en .env (GOOGLE_REFRESH_TOKEN).
 * Pensado para abrirse manualmente en el navegador del dueño de la cuenta,
 * no para ser llamado por un cliente de la API.
 */
@ApiExcludeController()
@Public()
@Controller('auth/gmail')
export class GmailAuthController {
  constructor(private readonly gmailApi: GmailApiService) {}

  @Get()
  redirectToConsent(@Res() res: Response) {
    res.redirect(this.gmailApi.getAuthUrl());
  }

  @Get('callback')
  async handleCallback(@Query('code') code: string, @Res() res: Response) {
    if (!code) {
      res.status(400).send('Falta el parámetro "code" en la respuesta de Google.');
      return;
    }
    const tokens = await this.gmailApi.exchangeCodeForTokens(code);
    if (!tokens.refresh_token) {
      res.status(200).send(
        'Google no devolvió un refresh_token (probablemente ya habías autorizado antes). ' +
          'Revoca el acceso en https://myaccount.google.com/permissions y vuelve a intentar en /auth/gmail.',
      );
      return;
    }
    res.status(200).send(
      `<pre>Copia este valor en tu .env como GOOGLE_REFRESH_TOKEN y reinicia el servidor:\n\n${tokens.refresh_token}</pre>`,
    );
  }
}
