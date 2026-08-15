import type { ArtifactStorage } from '@trace/report-storage';

export const REPORT_ARTIFACT_STORAGE = Symbol('REPORT_ARTIFACT_STORAGE') as symbol & {
  readonly __type?: ArtifactStorage;
};
