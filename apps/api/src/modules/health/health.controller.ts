import { Controller, Get, HttpStatus } from '@nestjs/common';
import { AppException } from '../../common/filters/global-exception.filter';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- value import required for emitDecoratorMetadata / NestJS DI token
import { DbService } from '../../infra/db/db.service';

@Controller('health')
export class HealthController {
  constructor(private readonly db: DbService) {}

  @Get('liveness')
  liveness() {
    return { status: 'ok' };
  }

  @Get('readiness')
  async readiness() {
    try {
      await this.db.ping();
    } catch {
      throw new AppException('not_ready', 'Database unreachable', HttpStatus.SERVICE_UNAVAILABLE);
    }
    return { status: 'ok', db: 'up' };
  }
}
