import { Big } from 'big.js';

/**
 * Carries the latest known market price forward to `endDateString` for every
 * symbol that has no price on that date, e.g. because the live quote request
 * to the data provider failed or timed out.
 *
 * Without this, the portfolio calculator falls back to the average (cost
 * basis) price of the position, which silently values the holding at what was
 * paid for it instead of what it is worth.
 *
 * Mutates `marketSymbolMap` and returns the symbols that were carried forward.
 */
export function carryForwardMarketPrices({
  endDateString,
  marketSymbolMap,
  symbols
}: {
  endDateString: string;
  marketSymbolMap: { [date: string]: { [symbol: string]: Big } };
  symbols: string[];
}): { date: string; symbol: string }[] {
  const carriedForward: { date: string; symbol: string }[] = [];

  const datesDescending = Object.keys(marketSymbolMap)
    .filter((date) => {
      return date < endDateString;
    })
    .sort()
    .reverse();

  for (const symbol of symbols) {
    if (marketSymbolMap[endDateString]?.[symbol]) {
      continue;
    }

    for (const date of datesDescending) {
      const marketPrice = marketSymbolMap[date]?.[symbol];

      if (marketPrice) {
        marketSymbolMap[endDateString] ??= {};
        marketSymbolMap[endDateString][symbol] = marketPrice;
        carriedForward.push({ date, symbol });
        break;
      }
    }
  }

  return carriedForward;
}
