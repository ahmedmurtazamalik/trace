import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { DependencyHealthService, type ReadinessResult } from './dependency-health.service';

@Controller()
export class HealthController {
  constructor(@Inject(DependencyHealthService) private readonly dependencyHealth: DependencyHealthService) {}

  @Get('health')
  health(): { status: 'ok'; service: 'trace-api' } {
    return { status: 'ok', service: 'trace-api' };
  }

  @Get('ready')
  async ready(): Promise<ReadinessResult> {
    const result = await this.dependencyHealth.check();
    if (result.status === 'not_ready') {
      throw new ServiceUnavailableException({
        code: 'DEPENDENCIES_UNAVAILABLE',
        message: 'Required dependencies are unavailable.',
      });
    }
    return result;
  }
}
