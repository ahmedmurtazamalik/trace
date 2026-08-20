import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ReportsModule } from '../reports/reports.module';
import { WorkspacesController } from './workspaces.controller';
import { WorkspaceAnalysisPublisher } from './workspace-analysis.publisher';
import { WorkspaceAnalysisQueue } from './workspace-analysis.queue';
import { WorkspaceAnalysisService } from './workspace-analysis.service';
import { WorkspaceReportScheduler } from './workspace-report.scheduler';
import { WorkspaceReportsService } from './workspace-reports.service';
import { WorkspaceReportSlackService } from './workspace-report-slack.service';
import { WorkspacesService } from './workspaces.service';

@Module({
  imports: [AuthModule, ReportsModule],
  controllers: [WorkspacesController],
  providers: [
    WorkspacesService,
    WorkspaceAnalysisQueue,
    WorkspaceAnalysisPublisher,
    WorkspaceAnalysisService,
    WorkspaceReportsService,
    WorkspaceReportSlackService,
    WorkspaceReportScheduler,
  ],
})
export class WorkspacesModule {}
