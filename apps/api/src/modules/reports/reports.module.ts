import { Module } from '@nestjs/common';
import { artifactStorageFromEnvironment } from '@trace/report-storage';
import { AuthModule } from '../auth/auth.module';
import { REPORT_ARTIFACT_STORAGE } from './report-storage.token';
import { ReportsController } from './reports.controller';
import { ReportPublisher } from './report.publisher';
import { ReportQueue } from './report.queue';
import { ReportsService } from './reports.service';

@Module({
  imports: [AuthModule],
  controllers: [ReportsController],
  providers: [
    ReportQueue,
    ReportPublisher,
    ReportsService,
    {
      provide: REPORT_ARTIFACT_STORAGE,
      useFactory: () => artifactStorageFromEnvironment(process.env),
    },
  ],
})
export class ReportsModule {}
