import { ConfigurationModule } from '@ghostfolio/api/services/configuration/configuration.module';
import { PrismaModule } from '@ghostfolio/api/services/prisma/prisma.module';

import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { SyncServiceController } from './sync-service.controller';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';

@Module({
  controllers: [SyncController, SyncServiceController],
  imports: [
    ConfigurationModule,
    // Same secret as AuthModule, so tokens issued here pass the JWT strategy
    JwtModule.register({ secret: process.env.JWT_SECRET_KEY }),
    PrismaModule
  ],
  providers: [SyncService]
})
export class SyncModule {}
