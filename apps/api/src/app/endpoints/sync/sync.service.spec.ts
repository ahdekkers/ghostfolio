import { BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SyncProvider } from '@prisma/client';

import { SyncService } from './sync.service';

describe('SyncService', () => {
  let rows: any[];
  let service: SyncService;

  beforeEach(() => {
    rows = [];

    const prismaService: any = {
      syncConnection: {
        count: jest.fn(async ({ where }) => {
          return rows.filter(({ userId }) => userId === where.userId).length;
        }),
        findMany: jest.fn(async () => rows),
        findUnique: jest.fn(async ({ where }) => {
          const { provider, userId } = where.userId_provider;

          return rows.find((row) => {
            return row.provider === provider && row.userId === userId;
          });
        }),
        upsert: jest.fn(async ({ create, update, where }) => {
          const { provider, userId } = where.userId_provider;
          const existing = rows.find((row) => {
            return row.provider === provider && row.userId === userId;
          });

          if (existing) {
            Object.assign(existing, update);

            return existing;
          }

          rows.push({ ...create, id: `${rows.length}` });

          return rows.at(-1);
        })
      }
    };

    const configurationService: any = {
      get: (key: string) => {
        return {
          SYNC_CREDENTIALS_KEY: 'test-key',
          SYNC_SERVICE_TOKEN: 'service-token'
        }[key];
      }
    };

    service = new SyncService(
      configurationService,
      new JwtService({ secret: 'jwt-secret' }),
      prismaService
    );
  });

  it('never stores the key or secret in plain text', async () => {
    await service.upsertConnection({
      data: { apiKey: 'kraken-key-1234', apiSecret: 'kraken-secret' },
      provider: SyncProvider.KRAKEN,
      userId: 'ephraim'
    });

    expect(rows[0].credentials).not.toContain('kraken-key');
    expect(rows[0].credentials).not.toContain('kraken-secret');
    expect(rows[0].hint).toBe('1234');
  });

  it('hands each user their own credentials and a token for themselves', async () => {
    await service.upsertConnection({
      data: { apiKey: 'alex-t212' },
      provider: SyncProvider.TRADING_212_ISA,
      userId: 'alex'
    });
    await service.upsertConnection({
      data: { apiKey: 'ephraim-kraken', apiSecret: 's' },
      provider: SyncProvider.KRAKEN,
      userId: 'ephraim'
    });

    const tenants = await service.getTenants();

    expect(tenants.map(({ userId }) => userId)).toEqual(['alex', 'ephraim']);
    expect(tenants[1].connections).toEqual([
      expect.objectContaining({
        apiKey: 'ephraim-kraken',
        provider: SyncProvider.KRAKEN
      })
    ]);
    expect(
      new JwtService({ secret: 'jwt-secret' }).verify(tenants[1].authToken).id
    ).toBe('ephraim');
  });

  it('refuses credentials moved onto another user', async () => {
    await service.upsertConnection({
      data: { apiKey: 'ephraim-kraken', apiSecret: 's' },
      provider: SyncProvider.KRAKEN,
      userId: 'ephraim'
    });
    rows[0].userId = 'mallory';

    expect(await service.getTenants()).toEqual([]);
  });

  it('requires a secret for Kraken but not for a legacy Trading 212 key', async () => {
    await expect(
      service.upsertConnection({
        data: { apiKey: 'k' },
        provider: SyncProvider.KRAKEN,
        userId: 'ephraim'
      })
    ).rejects.toBeInstanceOf(BadRequestException);

    await service.upsertConnection({
      data: { apiKey: 'legacy' },
      provider: SyncProvider.TRADING_212_INVEST,
      userId: 'ephraim'
    });
    expect(rows).toHaveLength(1);
  });

  it('compares the service token exactly', () => {
    expect(service.isValidServiceToken('service-token')).toBe(true);
    expect(service.isValidServiceToken('service-tokeN')).toBe(false);
    expect(service.isValidServiceToken(undefined)).toBe(false);
  });
});
