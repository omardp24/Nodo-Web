import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { RecordatoriosModule } from '../recordatorios/recordatorios.module.js';
import { GmailApiService } from './gmail-api.service.js';
import { GmailIngestService } from './gmail-ingest.service.js';
import { GmailAuthController } from './gmail-auth.controller.js';

@Module({
  imports: [ScheduleModule.forRoot(), RecordatoriosModule],
  controllers: [GmailAuthController],
  providers: [GmailApiService, GmailIngestService],
})
export class GmailModule {}
