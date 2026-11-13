import { ConfigurationService } from '@ghostfolio/api/services/configuration/configuration.service';
import {
  DataProviderInterface,
  GetAssetProfileParams,
  GetDividendsParams,
  GetHistoricalParams,
  GetQuotesParams,
  GetSearchParams
} from '@ghostfolio/api/services/data-provider/interfaces/data-provider.interface';
import { FetchService } from '@ghostfolio/api/services/fetch/fetch.service';
import { DEFAULT_CURRENCY } from '@ghostfolio/common/config';
import { DATE_FORMAT } from '@ghostfolio/common/helper';
import {
  DataProviderHistoricalResponse,
  DataProviderInfo,
  DataProviderResponse,
  LookupItem,
  LookupResponse
} from '@ghostfolio/common/interfaces';

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  AssetClass,
  AssetSubClass,
  DataSource,
  SymbolProfile
} from '@prisma/client';
import { format, fromUnixTime, getUnixTime } from 'date-fns';

@Injectable()
export class CoinGeckoService implements DataProviderInterface, OnModuleInit {
  private readonly logger = new Logger(CoinGeckoService.name);

  private apiUrl: string;
  private headers: HeadersInit = {};

  public constructor(
    private readonly configurationService: ConfigurationService,
    private readonly fetchService: FetchService
  ) {}

  public onModuleInit() {
    const apiKeyDemo = this.configurationService.get('API_KEY_COINGECKO_DEMO');
    const apiKeyPro = this.configurationService.get('API_KEY_COINGECKO_PRO');

    this.apiUrl = 'https://api.coingecko.com/api/v3';

    if (apiKeyDemo) {
      this.headers['x-cg-demo-api-key'] = apiKeyDemo;
    }

    if (apiKeyPro) {
      this.apiUrl = 'https://pro-api.coingecko.com/api/v3';
      this.headers['x-cg-pro-api-key'] = apiKeyPro;
    }
  }

  public canHandle() {
    return true;
  }

  public async getAssetProfile({
    symbol
  }: GetAssetProfileParams): Promise<Partial<SymbolProfile>> {
    const response: Partial<SymbolProfile> = {
      symbol,
      assetClass: AssetClass.LIQUIDITY,
      assetSubClass: AssetSubClass.CRYPTOCURRENCY,
      currency: DEFAULT_CURRENCY,
      dataSource: this.getName()
    };

    try {
      const { name } = await this.fetchService
        .fetch(`${this.apiUrl}/coins/${symbol}`, {
          headers: this.headers,
          signal: AbortSignal.timeout(
            this.configurationService.get('REQUEST_TIMEOUT')
          )
        })
        .then((res) => res.json());

      response.name = name;
    } catch (error) {
      let message = error;

      if (['AbortError', 'TimeoutError'].includes(error?.name)) {
        message = `RequestError: The operation to get the asset profile for ${symbol} was aborted because the request to the data provider took more than ${(
          this.configurationService.get('REQUEST_TIMEOUT') / 1000
        ).toFixed(3)} seconds`;
      }

      this.logger.error(message);
    }

    return response;
  }

  public getDataProviderInfo(): DataProviderInfo {
    return {
      dataSource: DataSource.COINGECKO,
      isPremium: false,
      name: 'CoinGecko',
      url: 'https://coingecko.com'
    };
  }

  public async getDividends({}: GetDividendsParams) {
    return {};
  }

  public async getHistorical({
    from,
    requestTimeout = this.configurationService.get('REQUEST_TIMEOUT'),
    symbol,
    to
  }: GetHistoricalParams): Promise<{
    [date: string]: DataProviderHistoricalResponse;
  }> {
    try {
      const queryParams = new URLSearchParams({
        from: getUnixTime(from).toString(),
        to: getUnixTime(to).toString(),
        vs_currency: DEFAULT_CURRENCY.toLowerCase()
      });

      const { error, prices, status } = await this.fetchService
        .fetch(
          `${this.apiUrl}/coins/${symbol}/market_chart/range?${queryParams.toString()}`,
          {
            headers: this.headers,
            signal: AbortSignal.timeout(requestTimeout)
          }
        )
        .then((res) => res.json());

      if (error?.status) {
        throw new Error(error.status.error_message);
      }

      if (status) {
        throw new Error(status.error_message);
      }

      const result: {
        [date: string]: DataProviderHistoricalResponse;
      } = {};

      for (const [timestamp, marketPrice] of prices) {
        result[format(fromUnixTime(timestamp / 1000), DATE_FORMAT)] = {
          marketPrice
        };
      }

      return result;
    } catch (error) {
      throw new Error(
        `Could not get historical market data for ${symbol} (${this.getName()}) from ${format(
          from,
          DATE_FORMAT
        )} to ${format(to, DATE_FORMAT)}: [${error.name}] ${error.message}`
      );
    }
  }

  public getMaxNumberOfSymbolsPerRequest() {
    return 50;
  }

  public getName(): DataSource {
    return DataSource.COINGECKO;
  }

  public async getQuotes({
    requestTimeout = this.configurationService.get('REQUEST_TIMEOUT'),
    symbols
  }: GetQuotesParams): Promise<{ [symbol: string]: DataProviderResponse }> {
    const response: { [symbol: string]: DataProviderResponse } = {};

    if (symbols.length <= 0) {
      return response;
    }

    try {
      const queryParams = new URLSearchParams({
        ids: symbols.join(','),
        vs_currencies: DEFAULT_CURRENCY.toLowerCase()
      });

      const quotes = await this.fetchQuotes({
        requestTimeout,
        url: `${this.apiUrl}/simple/price?${queryParams.toString()}`
      });

      for (const symbol of symbols) {
        // A rate-limited response is `{ status: { error_code: 429 } }`, so only
        // accept entries which carry an actual price
        const marketPrice = quotes?.[symbol]?.[DEFAULT_CURRENCY.toLowerCase()];

        if (typeof marketPrice !== 'number' || !(marketPrice > 0)) {
          continue;
        }

        response[symbol] = {
          marketPrice,
          currency: DEFAULT_CURRENCY,
          dataProviderInfo: this.getDataProviderInfo(),
          dataSource: DataSource.COINGECKO,
          marketState: 'open'
        };
      }
    } catch (error) {
      let message = error;

      if (['AbortError', 'TimeoutError'].includes(error?.name)) {
        message = `RequestError: The operation to get the quotes for ${symbols.join(
          ', '
        )} was aborted because the request to the data provider took more than ${(
          this.configurationService.get('REQUEST_TIMEOUT') / 1000
        ).toFixed(3)} seconds`;
      }

      this.logger.error(message);
    }

    return response;
  }

  private async fetchQuotes({
    requestTimeout,
    url
  }: {
    requestTimeout: number;
    url: string;
  }) {
    const maxAttempts = 3;

    for (let attempt = 1; ; attempt++) {
      try {
        const res = await this.fetchService.fetch(url, {
          headers: this.headers,
          signal: AbortSignal.timeout(requestTimeout)
        });

        if (res.status === 429 || res.status >= 500) {
          throw new Error(`CoinGecko responded with status ${res.status}`);
        }

        return await res.json();
      } catch (error) {
        if (attempt >= maxAttempts) {
          throw error;
        }

        this.logger.warn(
          `Quote request failed (attempt ${attempt} of ${maxAttempts}): ${error?.message ?? error}`
        );

        await new Promise((resolve) => {
          return setTimeout(resolve, attempt * 1000);
        });
      }
    }
  }

  public getTestSymbol() {
    return 'bitcoin';
  }

  public async search({
    query,
    requestTimeout = this.configurationService.get('REQUEST_TIMEOUT')
  }: GetSearchParams): Promise<LookupResponse> {
    let items: LookupItem[] = [];

    try {
      const queryParams = new URLSearchParams({
        query
      });

      const { coins } = await this.fetchService
        .fetch(`${this.apiUrl}/search?${queryParams.toString()}`, {
          headers: this.headers,
          signal: AbortSignal.timeout(requestTimeout)
        })
        .then((res) => res.json());

      items = coins.map(({ id: symbol, name }) => {
        return {
          name,
          symbol,
          assetClass: AssetClass.LIQUIDITY,
          assetSubClass: AssetSubClass.CRYPTOCURRENCY,
          currency: DEFAULT_CURRENCY,
          dataProviderInfo: this.getDataProviderInfo(),
          dataSource: this.getName()
        };
      });
    } catch (error) {
      let message = error;

      if (['AbortError', 'TimeoutError'].includes(error?.name)) {
        message = `RequestError: The operation to search for ${query} was aborted because the request to the data provider took more than ${(
          this.configurationService.get('REQUEST_TIMEOUT') / 1000
        ).toFixed(3)} seconds`;
      }

      this.logger.error(message);
    }

    return { items };
  }
}
