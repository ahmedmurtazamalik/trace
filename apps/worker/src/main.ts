import { startGithubActivityWorker } from './application';

void startGithubActivityWorker({ environment: process.env }).catch(() => {
  process.exitCode = 1;
});
