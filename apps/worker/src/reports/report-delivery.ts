export interface ReportDeliveryContext {
  attempt: number;
  maximumAttempts: number;
  finalDelivery: boolean;
}

export const DIRECT_REPORT_DELIVERY: Readonly<ReportDeliveryContext> = Object.freeze({
  attempt: 1,
  maximumAttempts: 1,
  finalDelivery: true,
});
