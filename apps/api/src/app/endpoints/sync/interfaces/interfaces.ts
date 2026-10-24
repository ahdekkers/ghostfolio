import { SyncProvider } from '@prisma/client';

export interface SyncConnectionResponse {
  accountName: string | null;
  hint: string;
  provider: SyncProvider;
  updatedAt: Date;
}

export interface SyncCredentials {
  apiKey: string;
  apiSecret: string;
}

export interface SyncStatusResponse {
  busy: boolean;
  isConfigured: boolean;
  isReachable: boolean;
  lastRun: {
    at: string;
    failures: string[];
    imported: number;
    ok: boolean;
    summary: string;
  } | null;
}

export interface SyncTenant {
  /**
   * Short-lived JWT for this user, so the sync service can import into their
   * portfolio without holding their security token
   */
  authToken: string;
  connections: (SyncCredentials & {
    accountName: string | null;
    provider: SyncProvider;
  })[];
  userId: string;
}
