import { Global, Module } from '@nestjs/common';
import { loadConfig } from '@trace/config';
import { TRACE_CONFIG } from './config.token';

@Global()
@Module({
  providers: [{ provide: TRACE_CONFIG, useFactory: () => loadConfig(process.env) }],
  exports: [TRACE_CONFIG],
})
export class TraceConfigModule {}
