import { Big } from 'big.js';

import { carryForwardMarketPrices } from './market-price.helper';

describe('carryForwardMarketPrices', () => {
  it('keeps a live price for the end date untouched', () => {
    const marketSymbolMap = {
      '2026-11-05': { bitcoin: new Big(75000) },
      '2026-11-06': { bitcoin: new Big(76000) }
    };

    const result = carryForwardMarketPrices({
      marketSymbolMap,
      endDateString: '2026-11-06',
      symbols: ['bitcoin']
    });

    expect(result).toEqual([]);
    expect(marketSymbolMap['2026-11-06'].bitcoin.toNumber()).toBe(76000);
  });

  it('carries the latest earlier price forward when the end date has none', () => {
    const marketSymbolMap: { [date: string]: { [symbol: string]: Big } } = {
      '2026-11-03': { bitcoin: new Big(70000), MRVL: new Big(100) },
      '2026-11-05': { bitcoin: new Big(75000) }
    };

    const result = carryForwardMarketPrices({
      marketSymbolMap,
      endDateString: '2026-11-06',
      symbols: ['bitcoin', 'MRVL']
    });

    expect(marketSymbolMap['2026-11-06'].bitcoin.toNumber()).toBe(75000);
    expect(marketSymbolMap['2026-11-06'].MRVL.toNumber()).toBe(100);
    expect(result).toEqual([
      { date: '2026-11-05', symbol: 'bitcoin' },
      { date: '2026-11-03', symbol: 'MRVL' }
    ]);
  });

  it('leaves a symbol without any price history alone', () => {
    const marketSymbolMap: { [date: string]: { [symbol: string]: Big } } = {
      '2026-11-05': { bitcoin: new Big(75000) }
    };

    const result = carryForwardMarketPrices({
      marketSymbolMap,
      endDateString: '2026-11-06',
      symbols: ['unknown']
    });

    expect(result).toEqual([]);
    expect(marketSymbolMap['2026-11-06']?.unknown).toBeUndefined();
  });

  it('never carries a price from a later date backwards', () => {
    const marketSymbolMap: { [date: string]: { [symbol: string]: Big } } = {
      '2026-11-07': { bitcoin: new Big(80000) }
    };

    const result = carryForwardMarketPrices({
      marketSymbolMap,
      endDateString: '2026-11-06',
      symbols: ['bitcoin']
    });

    expect(result).toEqual([]);
  });
});
