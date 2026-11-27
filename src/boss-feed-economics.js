import {validItemId} from './item-prices.js';
import {selectedUnitPrice} from './page-prices.js';

const known = value => Number.isFinite(value) && value >= 0;

export function batchQuantity(threshold, points) {
  if (!(threshold > 0 && points > 0)) return {quantity:null, chests:null};
  const quantity = Math.ceil(100 * threshold / points);
  return {quantity, chests:quantity * points / threshold};
}

export function quote(priceSnapshot, itemId, materialSource) {
  const row = priceSnapshot && validItemId(itemId) ? priceSnapshot.getItem(itemId) : null;
  return {
    unitPrice: row ? selectedUnitPrice(priceSnapshot,itemId,materialSource) : null,
    sellQty: marketSellQuantity(row),
  };
}

export function marketSellQuantity(row) {
  return known(row?.sellQuantity) ? row.sellQuantity : row?.market.status.sellPrice === 'noOrders' ? 0 : null;
}

export function procurementGold(materials) {
  if (!materials || materials.some(row => !known(row.unitPrice) || !known(row.quantity))) return null;
  return materials.reduce((sum, row) => sum + row.quantity * row.unitPrice, 0);
}

export function marketSupply(materials, quantity) {
  const unknown = {supply:null, limitingIds:[]};
  if (!materials?.length || !(quantity > 0)) return unknown;
  const limits = materials.map(row => ({id:row.id,
    output:known(row.sellQty) && row.quantity > 0 ? row.sellQty * quantity / row.quantity : null}));
  const available = limits.filter(row => row.output !== null);
  const minimum = Math.min(...available.map(row => row.output));
  if (minimum !== 0 && available.length !== limits.length) return unknown;
  return {supply:Math.floor(minimum), limitingIds:available.filter(row => row.output === minimum).map(row => row.id)};
}

export function goldCost({materialGold, feedSeconds, craftSeconds, dailyProfit, chargeCraftTime}) {
  const chargedCraftSeconds = chargeCraftTime ? craftSeconds : 0;
  const countedSeconds = known(feedSeconds) && known(chargedCraftSeconds) ? feedSeconds + chargedCraftSeconds : null;
  const opportunityGold = dailyProfit === 0 ? 0 : known(countedSeconds) && known(dailyProfit)
    ? countedSeconds * (dailyProfit / 86400) : null;
  return {
    countedSeconds,
    opportunityGold,
    totalGold: known(materialGold) && known(opportunityGold) ? materialGold + opportunityGold : null,
  };
}
