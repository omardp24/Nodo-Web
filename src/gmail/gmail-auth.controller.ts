import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator.js';
import { GmailApiService } from './gmail-api.service.js';
import { GmailAccountsService } from './gmail-accounts.service.js';

/**
 * Flujo de consentimiento OAuth de Google para conectar una cuenta de Gmail
 * (personal, corporativa, la que sea) a la ingesta de correos. Pensado para
 * abrirse manualmente en el navegador del dueño de la cuenta, no para ser
 * llamado por un cliente de la API. Se puede repetir para conectar cuantas
 * cuentas se quiera — cada una se identifica por su email y se guarda (o
 * actualiza) en la tabla `cuentas_gmail`, sin tocar el .env.
 */
@ApiExcludeController()
@Public()
@Controller('auth/gmail')
export class GmailAuthController {
  constructor(
    private readonly gmailApi: GmailApiService,
    private readonly cuentas: GmailAccountsService,
  ) {}

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
        'Google no devolvió un refresh_token (probablemente ya habías autorizado esta cuenta antes). ' +
          'Revoca el acceso en https://myaccount.google.com/permissions y vuelve a intentar en /auth/gmail.',
      );
      return;
    }
    const email = await this.gmailApi.getUserEmail(tokens.access_token);
    const filtrarPorPrincipal = await this.gmailApi.tieneCategoriaPrimaria(tokens.refresh_token);
    await this.cuentas.guardar(email, tokens.refresh_token, filtrarPorPrincipal);
    res.status(200).send(
      `<pre>Cuenta "${email}" conectada correctamente${filtrarPorPrincipal ? '' : ' (esta cuenta no usa pestañas de Gmail — se va a revisar todo el inbox, no solo "Principal")'}. La ingesta de correos la incluirá desde el próximo ciclo (cada 5 minutos), sin necesidad de reiniciar el servidor.\n\nPara conectar otra cuenta, volvé a abrir /auth/gmail.</pre>`,
    );
  }
}
