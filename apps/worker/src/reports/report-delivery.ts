import type { FinalizedReportNotification } from './report-slack-notifier';

export interface ReportDeliveryContext {
  attempt: number;
  maximumAttempts: number;
  finalDelivery: boolean;
}

export class ReportNotificationRetryError extends Error {
  constructor(readonly notification: FinalizedReportNotification) {
    super('REPORT_NOTIFICATION_RETRY');
    this.name = 'ReportNotificationRetryError';
  }
}

export const DIRECT_REPORT_DELIVERY: Readonly<ReportDeliveryContext> = Object.freeze({
  attempt: 1,
  maximumAttempts: 1,
  finalDelivery: true,
});
