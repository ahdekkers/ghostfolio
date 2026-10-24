import { ImpersonationStorageService } from '@ghostfolio/client/services/impersonation-storage.service';
import { ConfirmationDialogType } from '@ghostfolio/common/enums';
import { NotificationService } from '@ghostfolio/ui/notifications';

import { DatePipe } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  OnInit,
  signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { EMPTY, Subscription, timer } from 'rxjs';
import { catchError } from 'rxjs/operators';

type SyncProvider =
  'COINBASE' | 'KRAKEN' | 'TRADING_212_INVEST' | 'TRADING_212_ISA';

interface SyncConnection {
  accountName: string | null;
  hint: string;
  provider: SyncProvider;
  updatedAt: string;
}

interface SyncStatus {
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

interface ProviderDefinition {
  defaultAccountName: string;
  help: string;
  id: SyncProvider;
  isSecretMultiline: boolean;
  isSecretRequired: boolean;
  name: string;
}

// Keep the default account names in step with the sync service
// (finance_sync/tenants.py), which creates the Ghostfolio accounts.
const PROVIDERS: ProviderDefinition[] = [
  {
    defaultAccountName: 'Trading 212 Stocks & Shares ISA',
    help: $localize`In the Trading 212 app, switch to your ISA, then Settings → API (Beta) → Generate key. Read-only permissions are enough. A key belongs to the account it was made in.`,
    id: 'TRADING_212_ISA',
    isSecretMultiline: false,
    isSecretRequired: false,
    name: 'Trading 212 ISA'
  },
  {
    defaultAccountName: 'Trading 212 Invest',
    help: $localize`In the Trading 212 app, switch to your Invest account, then Settings → API (Beta) → Generate key. Newer keys come with a secret; older ones are a single value.`,
    id: 'TRADING_212_INVEST',
    isSecretMultiline: false,
    isSecretRequired: false,
    name: 'Trading 212 Invest'
  },
  {
    defaultAccountName: 'Kraken',
    help: $localize`On kraken.com: Settings → API → Create API key. Tick only “Query Funds” and “Query Ledger Entries”. Never grant trading, deposit or withdrawal permissions.`,
    id: 'KRAKEN',
    isSecretMultiline: false,
    isSecretRequired: true,
    name: 'Kraken'
  },
  {
    defaultAccountName: 'Coinbase',
    help: $localize`Create a secret API key at portal.cdp.coinbase.com/access/api with the “View” permission only. The key is the name (organizations/…/apiKeys/…), the secret is the private key.`,
    id: 'COINBASE',
    isSecretMultiline: true,
    isSecretRequired: true,
    name: 'Coinbase'
  }
];

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    ReactiveFormsModule
  ],
  selector: 'gf-user-account-sync',
  styleUrls: ['./user-account-sync.scss'],
  templateUrl: './user-account-sync.html'
})
export class GfUserAccountSyncComponent implements OnInit {
  protected readonly connections = signal<
    Partial<Record<SyncProvider, SyncConnection>>
  >({});
  protected readonly forms = Object.fromEntries(
    PROVIDERS.map(({ id }) => {
      return [
        id,
        new FormGroup({
          accountName: new FormControl<string>('', { nonNullable: true }),
          apiKey: new FormControl<string>('', { nonNullable: true }),
          apiSecret: new FormControl<string>('', { nonNullable: true })
        })
      ];
    })
  ) as Record<SyncProvider, FormGroup>;
  protected readonly hasImpersonationId = signal(false);
  protected readonly isStarting = signal(false);
  protected readonly providers = PROVIDERS;
  protected readonly savingProvider = signal<SyncProvider | null>(null);
  protected readonly status = signal<SyncStatus | null>(null);

  private readonly destroyRef = inject(DestroyRef);
  private readonly http = inject(HttpClient);
  private readonly impersonationStorageService = inject(
    ImpersonationStorageService
  );
  private readonly notificationService = inject(NotificationService);
  private pollSubscription: Subscription | null = null;

  public ngOnInit() {
    this.impersonationStorageService
      .onChangeHasImpersonation()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((impersonationId) => {
        this.hasImpersonationId.set(!!impersonationId);
      });

    this.fetchConnections();
    this.fetchStatus();
  }

  protected hasConnections() {
    return Object.keys(this.connections()).length > 0;
  }

  protected onRemove(provider: ProviderDefinition) {
    this.notificationService.confirm({
      confirmFn: () => {
        this.http
          .delete(`/api/v1/sync/connections/${provider.id}`)
          .pipe(
            catchError(() => {
              this.notificationService.alert({
                title: $localize`Oops! Could not remove the API key.`
              });

              return EMPTY;
            }),
            takeUntilDestroyed(this.destroyRef)
          )
          .subscribe(() => {
            this.forms[provider.id].reset();
            this.fetchConnections();
          });
      },
      confirmType: ConfirmationDialogType.Warn,
      title: $localize`Remove the ${provider.name} API key? Activities already imported stay in your portfolio.`
    });
  }

  protected onSave(provider: ProviderDefinition) {
    const form = this.forms[provider.id];
    const { accountName, apiKey, apiSecret } = form.getRawValue();
    const isConnected = !!this.connections()[provider.id];

    if (!apiKey.trim() && !isConnected) {
      return;
    }

    this.savingProvider.set(provider.id);

    // Blank fields are omitted, so a rename keeps the stored credentials
    const trimmedKey = apiKey.trim();
    const trimmedSecret = apiSecret.trim();

    this.http
      .put<SyncConnection>(`/api/v1/sync/connections/${provider.id}`, {
        accountName,
        apiKey: trimmedKey === '' ? undefined : trimmedKey,
        apiSecret: trimmedSecret === '' ? undefined : trimmedSecret
      })
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this.savingProvider.set(null);
          this.notificationService.alert({
            message: error.error?.message,
            title: $localize`Oops! Could not save the API key.`
          });

          return EMPTY;
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => {
        this.savingProvider.set(null);

        // Secrets are write-only: clear them from the form once stored
        form.controls.apiKey.reset();
        form.controls.apiSecret.reset();
        form.markAsPristine();

        this.fetchConnections();
      });
  }

  protected onSyncNow() {
    this.isStarting.set(true);

    this.http
      .post<{ status: string }>('/api/v1/sync/run', {})
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this.isStarting.set(false);
          this.notificationService.alert({
            message: error.error?.message,
            title: $localize`Oops! Could not start the sync.`
          });

          return EMPTY;
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => {
        this.isStarting.set(false);
        this.status.update((status) => {
          return status ? { ...status, busy: true } : status;
        });
        this.pollWhileBusy();
      });
  }

  protected canSave(provider: ProviderDefinition) {
    const form = this.forms[provider.id];
    const { apiKey, apiSecret } = form.getRawValue();

    if (apiKey.trim()) {
      return !provider.isSecretRequired || !!apiSecret.trim();
    }

    // Without a new key, saving only renames an existing connection
    return !!this.connections()[provider.id] && form.controls.accountName.dirty;
  }

  private fetchConnections() {
    this.http
      .get<SyncConnection[]>('/api/v1/sync/connections')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((connections) => {
        const byProvider: Partial<Record<SyncProvider, SyncConnection>> = {};

        for (const connection of connections) {
          byProvider[connection.provider] = connection;
          this.forms[connection.provider].controls.accountName.setValue(
            connection.accountName ?? ''
          );
        }

        this.connections.set(byProvider);
      });
  }

  private fetchStatus() {
    this.http
      .get<SyncStatus>('/api/v1/sync/status')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((status) => {
        this.status.set(status);

        if (status.busy) {
          this.pollWhileBusy();
        }
      });
  }

  private pollWhileBusy() {
    if (this.pollSubscription) {
      return;
    }

    this.pollSubscription = timer(3000, 5000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.http.get<SyncStatus>('/api/v1/sync/status').subscribe((status) => {
          this.status.set(status);

          if (!status.busy) {
            this.pollSubscription?.unsubscribe();
            this.pollSubscription = null;
          }
        });
      });
  }
}
