import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ReportsController } from './reports.controller';
import { ReportPublisher } from './report.publisher';
import { ReportQueue } from './report.queue';
import { ReportsService } from './reports.service';

@Module({
  imports: [AuthModule],
  controllers: [ReportsController],
  providers: [ReportQueue, ReportPublisher, ReportsService],
})
export class ReportsModule {}
