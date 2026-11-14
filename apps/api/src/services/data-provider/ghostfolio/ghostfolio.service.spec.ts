import { ConfigurationService } from '@ghostfolio/api/services/configuration/configuration.service';
import { FetchService } from '@ghostfolio/api/services/fetch/fetch.service';
import { PropertyService } from '@ghostfolio/api/services/property/property.service';

import { DataSource } from '@prisma/client';

import { GhostfolioService } from './ghostfolio.service';

jest.mock('@ghostfolio/api/services/fetch/fetch.service', () => ({
  FetchService: jest.fn()
}));

const mockEnvironment = { production: false };

jest.mock('@ghostfolio/api/environments/environment', () => ({
  get environment() {
    return mockEnvironment;
  }
}));

describe('GhostfolioService', () => {
  let fetchService: { fetch: jest.Mock };
  let propertyService: { getByKey: jest.Mock };

  function create(customUrl: string, production = false) {
    mockEnvironment.production = production;

    const values = {
      DATA_PROVIDER_GHOSTFOLIO_URL: customUrl,
      REQUEST_TIMEOUT: 2000,
      ROOT_URL: 'http://localhost:3333'
    };

    const configurationService = {
      get: jest.fn((key: string) => values[key])
    };

    return new GhostfolioService(
      configurationService as unknown as ConfigurationService,
      fetchService as unknown as FetchService,
      propertyService as unknown as PropertyService
    );
  }

  beforeEach(() => {
    fetchService = {
      fetch: jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ historicalData: {}, quotes: {} })
      })
    };
    propertyService = { getByKey: jest.fn().mockResolvedValue('test-key') };
  });

  it('uses the override for getQuotes and getHistorical, stripping trailing slash', async () => {
    const service = create('http://example.test/api/');

    await service.getQuotes({ symbols: ['AAPL'] });
    await service.getHistorical({
      from: new Date('2024-01-01'),
      symbol: 'AAPL',
      to: new Date('2024-01-31')
    });

    expect(fetchService.fetch.mock.calls[0][0]).toBe(
      'http://example.test/api/v2/data-providers/ghostfolio/quotes?symbols=AAPL'
    );
    expect(fetchService.fetch.mock.calls[1][0]).toMatch(
      /^http:\/\/example\.test\/api\/v2\/data-providers\/ghostfolio\/historical\/AAPL\?/
    );
  });

  it('uses the production default when unset', async () => {
    const service = create('', true);

    await service.getQuotes({ symbols: ['AAPL'] });

    expect(fetchService.fetch.mock.calls[0][0]).toBe(
      'https://ghostfol.io/api/v2/data-providers/ghostfolio/quotes?symbols=AAPL'
    );
  });

  it('uses ROOT_URL in non-production when unset', async () => {
    const service = create('', false);

    await service.getQuotes({ symbols: ['AAPL'] });

    expect(fetchService.fetch.mock.calls[0][0]).toBe(
      'http://localhost:3333/api/v2/data-providers/ghostfolio/quotes?symbols=AAPL'
    );
  });

  it('returns custom data provider info with override', () => {
    expect(
      create('http://example.test:8000/api/').getDataProviderInfo()
    ).toEqual({
      dataSource: DataSource.GHOSTFOLIO,
      isPremium: true,
      name: 'Ghostfolio (custom endpoint)',
      url: 'http://example.test:8000'
    });
  });

  it('returns default data provider info without override', () => {
    expect(create('').getDataProviderInfo()).toEqual({
      dataSource: DataSource.GHOSTFOLIO,
      isPremium: true,
      name: 'Ghostfolio',
      url: 'https://ghostfol.io'
    });
  });

  it('sends the Api-Key authorization header', async () => {
    const service = create('http://example.test/api');

    await service.getQuotes({ symbols: ['AAPL'] });

    expect(fetchService.fetch.mock.calls[0][1].headers).toEqual({
      Authorization: 'Api-Key test-key'
    });
  });
});
