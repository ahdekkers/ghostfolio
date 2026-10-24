import { HasPermission } from '@ghostfolio/api/decorators/has-permission.decorator';
import { HasPermissionGuard } from '@ghostfolio/api/guards/has-permission.guard';
import { permissions } from '@ghostfolio/common/permissions';
import type { RequestWithUser } from '@ghostfolio/common/types';

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseEnumPipe,
  Post,
  Put,
  UseGuards
} from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { SyncProvider } from '@prisma/client';

import {
  SyncConnectionResponse,
  SyncStatusResponse
} from './interfaces/interfaces';
import { SyncService } from './sync.service';
import { UpdateSyncConnectionDto } from './update-sync-connection.dto';

/**
 * Self-service sync settings. Every route acts on the authenticated user only:
 * the user id comes from the JWT, never from the request.
 */
@Controller('sync')
export class SyncController {
  public constructor(
    @Inject(REQUEST) private readonly request: RequestWithUser,
    private readonly syncService: SyncService
  ) {}

  @Get('connections')
  @HasPermission(permissions.manageSyncConnections)
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard)
  public async getConnections(): Promise<SyncConnectionResponse[]> {
    return this.syncService.getConnections(this.request.user.id);
  }

  @HasPermission(permissions.manageSyncConnections)
  @Put('connections/:provider')
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard)
  public async updateConnection(
    @Param('provider', new ParseEnumPipe(SyncProvider)) provider: SyncProvider,
    @Body() data: UpdateSyncConnectionDto
  ): Promise<SyncConnectionResponse> {
    return this.syncService.upsertConnection({
      data,
      provider,
      userId: this.request.user.id
    });
  }

  @Delete('connections/:provider')
  @HasPermission(permissions.manageSyncConnections)
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard)
  public async deleteConnection(
    @Param('provider', new ParseEnumPipe(SyncProvider)) provider: SyncProvider
  ) {
    await this.syncService.deleteConnection({
      provider,
      userId: this.request.user.id
    });
  }

  @Get('status')
  @HasPermission(permissions.manageSyncConnections)
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard)
  public async getStatus(): Promise<SyncStatusResponse> {
    return this.syncService.getStatus(this.request.user.id);
  }

  @HasPermission(permissions.manageSyncConnections)
  @HttpCode(HttpStatus.ACCEPTED)
  @Post('run')
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard)
  public async run() {
    return this.syncService.startSync(this.request.user.id);
  }
}
