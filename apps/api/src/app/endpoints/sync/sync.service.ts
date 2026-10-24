import { ConfigurationService } from '@ghostfolio/api/services/configuration/configuration.service';
import { PrismaService } from '@ghostfolio/api/services/prisma/prisma.service';

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SyncProvider } from '@prisma/client';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual
} from 'node:crypto';

import {
  SyncConnectionResponse,
  SyncCredentials,
  SyncStatusResponse,
  SyncTenant
} from './interfaces/interfaces';
import { UpdateSyncConnectionDto } from './update-sync-connection.dto';

/**
 * Per-user broker credentials for the finance sync service, and the bridge to
 * that service.
 *
 * Every user-facing method takes the authenticated user's id and touches only
 * rows of that user. Credentials are encrypted with AES-256-GCM, and the user
 * id and provider are bound into the ciphertext as additional authenticated
 * data, so a row copied onto another user or provider fails to decrypt.
 */
@Injectable()
export class SyncService {
  private static readonly CIPHER = 'aes-256-gcm';
  private static readonly SERVICE_TIMEOUT_MS = 10_000;
  private static readonly TENANT_TOKEN_EXPIRY = '6h';
  private static readonly VERSION = 'v1';

  private static readonly PROVIDERS_REQUIRING_SECRET: SyncProvider[] = [
    SyncProvider.COINBASE,
    SyncProvider.KRAKEN
  ];

  private readonly logger = new Logger(SyncService.name);

  public constructor(
    private readonly configurationService: ConfigurationService,
    private readonly jwtService: JwtService,
    private readonly prismaService: PrismaService
  ) {}

  public isConfigured() {
    return !!this.configurationService.get('SYNC_CREDENTIALS_KEY');
  }

  // --- connections (always scoped to one user) ------------------------------
  public async getConnections(
    userId: string
  ): Promise<SyncConnectionResponse[]> {
    return this.prismaService.syncConnection.findMany({
      orderBy: { provider: 'asc' },
      select: {
        accountName: true,
        hint: true,
        provider: true,
        updatedAt: true
      },
      where: { userId }
    });
  }

  public async upsertConnection({
    data,
    provider,
    userId
  }: {
    data: UpdateSyncConnectionDto;
    provider: SyncProvider;
    userId: string;
  }): Promise<SyncConnectionResponse> {
    this.assertConfigured();

    const accountName = data.accountName?.trim() || null;
    const apiKey = data.apiKey?.trim();
    const apiSecret = data.apiSecret?.trim() ?? '';

    const existing = await this.prismaService.syncConnection.findUnique({
      where: { userId_provider: { provider, userId } }
    });

    if (!apiKey) {
      if (!existing) {
        throw new BadRequestException('An API key is required');
      }

      // Rename only: the stored credentials stay as they are
      return this.prismaService.syncConnection.update({
        data: { accountName },
        select: {
          accountName: true,
          hint: true,
          provider: true,
          updatedAt: true
        },
        where: { id: existing.id }
      });
    }

    if (
      SyncService.PROVIDERS_REQUIRING_SECRET.includes(provider) &&
      !apiSecret
    ) {
      throw new BadRequestException('This provider needs an API secret too');
    }

    const credentials = this.encrypt({
      credentials: { apiKey, apiSecret },
      provider,
      userId
    });
    const hint = apiKey.slice(-4);

    return this.prismaService.syncConnection.upsert({
      create: { accountName, credentials, hint, provider, userId },
      select: {
        accountName: true,
        hint: true,
        provider: true,
        updatedAt: true
      },
      update: { accountName, credentials, hint },
      where: { userId_provider: { provider, userId } }
    });
  }

  public async deleteConnection({
    provider,
    userId
  }: {
    provider: SyncProvider;
    userId: string;
  }) {
    const { count } = await this.prismaService.syncConnection.deleteMany({
      where: { provider, userId }
    });

    if (count === 0) {
      throw new NotFoundException();
    }
  }

  // --- the sync service, on behalf of one user ------------------------------
  public async getStatus(userId: string): Promise<SyncStatusResponse> {
    const status: SyncStatusResponse = {
      busy: false,
      isConfigured: this.isConfigured(),
      isReachable: false,
      lastRun: null
    };

    if (!status.isConfigured) {
      return status;
    }

    try {
      const response = await this.callSyncService(
        'GET',
        `/users/${encodeURIComponent(userId)}/status`
      );

      if (response.ok) {
        const body = await response.json();

        status.busy = !!body.busy;
        status.isReachable = true;
        status.lastRun = body.last_run ?? null;
      }
    } catch (error) {
      this.logger.warn(`Sync service status failed: ${error}`);
    }

    return status;
  }

  public async startSync(userId: string) {
    this.assertConfigured();

    const connectionCount = await this.prismaService.syncConnection.count({
      where: { userId }
    });

    if (connectionCount === 0) {
      throw new BadRequestException('Add an API key first');
    }

    let response: Response;

    try {
      response = await this.callSyncService(
        'POST',
        `/users/${encodeURIComponent(userId)}/sync`
      );
    } catch (error) {
      this.logger.warn(`Sync service trigger failed: ${error}`);

      throw new ServiceUnavailableException('The sync service is unreachable');
    }

    if (response.status === 409) {
      return { status: 'already running' };
    }

    if (!response.ok) {
      throw new ServiceUnavailableException(
        `The sync service answered ${response.status}`
      );
    }

    return { status: 'started' };
  }

  // --- for the sync service itself -----------------------------------------
  public isValidServiceToken(supplied: string | undefined) {
    const expected = this.configurationService.get('SYNC_SERVICE_TOKEN');

    if (!expected || !supplied) {
      return false;
    }

    const a = Buffer.from(supplied);
    const b = Buffer.from(expected);

    return a.length === b.length && timingSafeEqual(a, b);
  }

  public async getTenants(): Promise<SyncTenant[]> {
    this.assertConfigured();

    const rows = await this.prismaService.syncConnection.findMany({
      orderBy: [{ userId: 'asc' }, { provider: 'asc' }]
    });

    const tenants = new Map<string, SyncTenant>();

    for (const row of rows) {
      let credentials: SyncCredentials;

      try {
        credentials = this.decrypt({
          payload: row.credentials,
          provider: row.provider,
          userId: row.userId
        });
      } catch {
        // A wrong key or a tampered row: skip it rather than fail everyone
        this.logger.error(
          `Could not decrypt the ${row.provider} credentials of user ${row.userId}`
        );

        continue;
      }

      if (!tenants.has(row.userId)) {
        tenants.set(row.userId, {
          authToken: this.jwtService.sign(
            { id: row.userId },
            { expiresIn: SyncService.TENANT_TOKEN_EXPIRY }
          ),
          connections: [],
          userId: row.userId
        });
      }

      tenants.get(row.userId).connections.push({
        ...credentials,
        accountName: row.accountName,
        provider: row.provider
      });
    }

    return [...tenants.values()];
  }

  // --- internals ------------------------------------------------------------
  private assertConfigured() {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        'Sync is not set up on this server (SYNC_CREDENTIALS_KEY is missing)'
      );
    }
  }

  private callSyncService(method: 'GET' | 'POST', path: string) {
    const baseUrl = this.configurationService
      .get('SYNC_SERVICE_URL')
      .replace(/\/+$/, '');

    return fetch(`${baseUrl}${path}`, {
      headers: {
        'X-Service-Token': this.configurationService.get('SYNC_SERVICE_TOKEN')
      },
      method,
      signal: AbortSignal.timeout(SyncService.SERVICE_TIMEOUT_MS)
    });
  }

  private key() {
    // Any string works as the configured secret; hashing yields the 32 bytes
    // AES-256 needs
    return createHash('sha256')
      .update(this.configurationService.get('SYNC_CREDENTIALS_KEY'))
      .digest();
  }

  private static aad(userId: string, provider: SyncProvider) {
    return Buffer.from(`${userId}:${provider}`);
  }

  private encrypt({
    credentials,
    provider,
    userId
  }: {
    credentials: SyncCredentials;
    provider: SyncProvider;
    userId: string;
  }) {
    const iv = randomBytes(12);
    const cipher = createCipheriv(SyncService.CIPHER, this.key(), iv);

    cipher.setAAD(SyncService.aad(userId, provider));

    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(credentials), 'utf8'),
      cipher.final()
    ]);

    return [
      SyncService.VERSION,
      Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64')
    ].join(':');
  }

  private decrypt({
    payload,
    provider,
    userId
  }: {
    payload: string;
    provider: SyncProvider;
    userId: string;
  }): SyncCredentials {
    const [version, encoded] = payload.split(':');

    if (version !== SyncService.VERSION || !encoded) {
      throw new Error('Unknown credentials format');
    }

    const raw = Buffer.from(encoded, 'base64');
    const decipher = createDecipheriv(
      SyncService.CIPHER,
      this.key(),
      raw.subarray(0, 12)
    );

    decipher.setAAD(SyncService.aad(userId, provider));
    decipher.setAuthTag(raw.subarray(12, 28));

    const plaintext = Buffer.concat([
      decipher.update(raw.subarray(28)),
      decipher.final()
    ]).toString('utf8');

    return JSON.parse(plaintext);
  }
}
