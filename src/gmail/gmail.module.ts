import { Module } from '@nestjs/common';
import { RecordatoriosModule } from '../recordatorios/recordatorios.module.js';
import { AsistenteModule } from '../asistente/asistente.module.js';
import { GmailApiService } from './gmail-api.service.js';
import { GmailIngestService } from './gmail-ingest.service.js';
import { GmailAuthController } from './gmail-auth.controller.js';

@Module({
  imports: [RecordatoriosModule, AsistenteModule],
  controllers: [GmailAuthController],
  providers: [GmailApiService, GmailIngestService],
})
export class GmailModule {}
