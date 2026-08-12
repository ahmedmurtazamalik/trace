import 'reflect-metadata';
import { createApplication } from './bootstrap';
import { TRACE_CONFIG } from './common/config/config.token';
import type { TraceConfig } from '@trace/config';

async function bootstrap(): Promise<void> {
  const app = await createApplication();
  const config = app.get<TraceConfig>(TRACE_CONFIG);
  await app.listen(config.port, '0.0.0.0');
}

void bootstrap();
