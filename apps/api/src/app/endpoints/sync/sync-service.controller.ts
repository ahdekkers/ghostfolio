import {
  Controller,
  ForbiddenException,
  Get,
  Headers,
  UnauthorizedException
} from '@nestjs/common';

import { SyncTenant } from './interfaces/interfaces';
import { SyncService } from './sync.service';

/**
 * Called by the finance sync container over the compose network, never by a
 * browser. It hands out decrypted credentials and a short-lived JWT per user,
 * so it is guarded by SYNC_SERVICE_TOKEN and refuses anything that came
 * through the reverse proxy (which always sets X-Forwarded-For).
 */
@Controller('sync-service')
export class SyncServiceController {
  public constructor(private readonly syncService: SyncService) {}

  @Get('tenants')
  public async getTenants(
    @Headers('x-forwarded-for') forwardedFor: string | undefined,
    @Headers('x-service-token') serviceToken: string | undefined
  ): Promise<SyncTenant[]> {
    if (forwardedFor) {
      throw new ForbiddenException();
    }

    if (!this.syncService.isValidServiceToken(serviceToken)) {
      throw new UnauthorizedException();
    }

    return this.syncService.getTenants();
  }
}
