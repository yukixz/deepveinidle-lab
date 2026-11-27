import {bossText,escape} from './boss-feed-copy.js';
import {compactNumber} from './number-format.js';

const pageSize = 10;
const categories = {
  ore:['矿石','Ore'], bars:['金属锭','Metal bars'], coal:['煤','Coal'], raw:['生鱼','Raw fish'],
  cooked:['熟鱼','Cooked fish'], logs:['原木','Logs'], bows:['弓','Bows'], staves:['法杖','Staves'],
  crops:['作物','Crops'], draughts:['药剂','Draughts'], herbs:['草药','Herbs'], bolts:['布匹','Bolts of cloth'],
  leather:['皮制品','Leather goods'], cloth:['布制品','Cloth goods'], essence:['首领精华','Boss essence'],
};
const reasons = {
  skillLevel:['缺少投喂技能等级','Missing feeding skill level'],
  bossSkillLevel:['缺少首领配对技能等级','Missing boss skill pair levels'],
  skillSpeed:['缺少有效工作速度','Missing work speed'],
  movementCapacity:['缺少有效背包容量','Missing backpack capacity'],
  movementSpeed:['缺少有效移动速度','Missing movement speed'],
  bossRoute:['缺少可核对的投喂路线','Missing feeding route'],
  itemStackability:['缺少物品堆叠规则','Missing item stacking rules'],
  levelTooLow:['制造技能等级不足','Crafting skill level too low'],
  unknownTime:['缺少制造耗时依据','Missing crafting time'],
  craftQuantity:['缺少目标制造数量','Missing target quantity'],
  ineligibleItem:['该首领无法接收此物品','This boss does not accept this item'],
  feedTime:['投喂耗时缺失','Feeding time unavailable'],
  missingPrice:['部分采购物品未定价','Some purchase items are unpriced'],
};
export const categoryLabel = (key,t) => categories[key] ? t(...categories[key]) : key;

export function visibleBossRows(rows, filters, sort) {
  const search = filters.search.trim().toLowerCase();
  const sortValue = row => sort.key.startsWith('xp:') ? row.xpBySkill[sort.key.slice(3)] : row[sort.key];
  return rows.filter(row => {
    if (!filters.qualities.includes(String(row.quality))) return false;
    if (filters.strategy !== 'both' && row.kind !== filters.strategy) return false;
    if (filters.skill && row.skill !== filters.skill) return false;
    if (filters.category && row.category !== filters.category) return false;
    if (filters.eligibleOnly && ['levelTooLow','ineligible'].includes(row.status)) return false;
    if (filters.minimumSupply !== null && !(Number.isFinite(row.supply) && row.supply > filters.minimumSupply)) return false;
    return !search || [row.name,row.englishName,row.itemId].some(value => String(value).toLowerCase().includes(search));
  }).sort((left,right) => {
    const a = sortValue(left), b = sortValue(right);
    if (Number.isFinite(a) !== Number.isFinite(b)) return Number.isFinite(a) ? -1 : 1;
    if (Number.isFinite(a) && a !== b) return sort.ascending ? a - b : b - a;
    return left.itemId - right.itemId || left.kind.localeCompare(right.kind);
  });
}

export function renderBossResults(host, {boss,language,rows,settings,sort,expanded,error,page}) {
  const {text:t,skill,rarity,named,number} = bossText(language);
  const compact = value => Number.isFinite(value) ? compactNumber(value) ?? number(value) : '—';
  const time = (value,exact = false) => {
    if (!Number.isFinite(value)) return '—';
    if (value < 60) return t(`${number(value)} 秒`,`${number(value)} s`);
    const seconds = Math.round(value);
    if (!exact && value < 3600) return t(`${Math.round(value / 60)} 分`,`${Math.round(value / 60)} min`);
    const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds / 60) % 60;
    return [
      hours ? t(`${hours} 小时`,`${hours} h`) : '',
      minutes ? t(`${minutes} 分`,`${minutes} min`) : '',
      exact && seconds % 60 ? t(`${seconds % 60} 秒`,`${seconds % 60} s`) : '',
    ].filter(Boolean).join(' ');
  };
  const reasonText = row => {
    if (row.reason === 'feedLevel') return t(`需要${skill(row.skill)} ${row.requiredLevel} 级`,`Requires ${skill(row.skill)} level ${row.requiredLevel}`);
    if (row.reason === 'bossLevel') return t(`配对技能至少一项需 ${row.requiredLevel} 级`,`One paired skill must be level ${row.requiredLevel}`);
    return row.reason ? t(...(reasons[row.reason] ?? ['估算资料缺失','Estimate unavailable'])) : '';
  };
  const name = item => named(item.name,item.englishName);
  const feedingSkill = row => row.skill === null ? t('任一栏','Any bar') : skill(row.skill);
  const kindLabel = row => row.kind === 'craft' ? t('自制','Craft') : t('直购','Buy');
  const quality = row => `<span class="boss-rarity" data-rarity="${row.quality}">${rarity(row.quality)}</span>`;

  function materials(row) {
    if (!row.materials.length) return `<p>${t('暂无采购明细。','No purchase details available.')}</p>`;
    return `<table class="boss-materials"><thead><tr><th scope="col">${t('采购物品','Purchase item')}</th><th scope="col">${t('用量','Quantity')}</th><th scope="col">${t('有效单价','Effective unit price')}</th><th scope="col">${t('卖单量','Quantity for sale')}</th></tr></thead>
      <tbody>${row.materials.map(item => `<tr><th scope="row">${escape(name(item))} ${quality(item)}${item.limiting ? `<small class="death-note">${t('限制供应','Limits supply')}</small>` : ''}</th><td>${number(item.quantity)}</td><td>${compact(item.unitPrice)}</td><td>${number(item.sellQty)}</td></tr>`).join('')}</tbody></table>`;
  }

  function detail(row, columns) {
    const stats = [
      [t('每件贡献','Contribution per item'), number(row.points)],
      [t('每件投喂经验','Feeding XP per item'), number(row.xpPerItem)],
      [t('每件纯投喂','Feeding action per item'), time(row.feedWorkSecondsPerItem)],
      [t('每件物流','Logistics per item'), time(row.feedLogisticsSecondsPerItem)],
      [t('每件总投喂耗时','Total feeding time per item'), time(row.feedSecondsPerItem)],
      [t('期望箱数','Expected chests'), number(row.chests)],
      [t('备料耗时','Preparation time'), time(row.craftSeconds,true)],
      [t('投喂耗时','Feeding time'), time(row.feedSeconds,true)],
      [t('计入成本的工时','Time charged'), time(row.countedSeconds,true)],
      [t('市场供应量','Market supply'), number(row.supply)],
      [t('物资采购额','Purchase cost'), compact(row.materialGold)],
      [t('收入损失','Income loss'), compact(row.opportunityGold)],
    ];
    const notes = [
      reasonText(row),
      row.note === 'regularRecipe' ? t('常规配方估算，未折减首领工具免耗。','Standard recipe estimate before boss tool material savings.') : '',
    ].filter(Boolean);
    const feedXp = Number.isFinite(row.xpPerItem) && Number.isFinite(row.quantity) ? row.xpPerItem * row.quantity : null;
    const purchaseTitle = row.kind === 'craft' ? t('配方原料','Recipe materials') : t('采购明细','Purchase details');
    return `<tr class="boss-detail-row" id="boss-feed-detail-${row.key}"><td colspan="${columns}">
      <div class="boss-row-detail">
        <dl>${stats.map(([label,value]) => `<div><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>
        <div><h3>${purchaseTitle}</h3>${materials(row)}
          <p class="micro">${t('投喂经验','Feeding XP')} · ${escape(feedingSkill(row))} ${number(feedXp)}</p>
          ${row.craftSkill ? `<p class="micro">${t('备料经验','Preparation XP')} · ${escape(skill(row.craftSkill))} ${number(row.craftXp)}</p>` : ''}</div>
        ${notes.length ? `<div class="boss-detail-notes">${notes.map(note => `<p class="death-note">${escape(note)}</p>`).join('')}</div>` : ''}
      </div></td></tr>`;
  }

  const columns = [
    [t('物品','Item')], [t('投喂技能','Feeding skill')], [t('备料方式','Preparation')],
    [t('交付件数','Items to feed'),'quantity'], [t('金币成本','Coin cost'),'totalGold'],
    [t('总耗时','Total time'),'totalSeconds'],
    ...boss.skills.map(key => [t(`${skill(key)}经验`,`${skill(key)} XP`),`xp:${key}`]),
  ];
  host.querySelector('thead').innerHTML = `<tr>${columns.map(([label,key]) => {
    const active = sort.key === key;
    const sorted = sort.ascending ? 'ascending' : 'descending';
    return `<th scope="col"${key === 'totalGold' ? ' class="column-highlight"' : ''}${active ? ` aria-sort="${sorted}"` : ''}>
      ${key ? `<button type="button" class="sort-header" data-boss-feed-sort="${key}">${escape(label)} <span class="sort-arrow" aria-hidden="true">${active ? sort.ascending ? '↑' : '↓' : '↕'}</span></button>` : escape(label)}</th>`;
  }).join('')}</tr>`;
  const filtered = visibleBossRows(rows,settings.filters,sort);
  const pageCount = Math.max(1,Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(Math.max(1,page),pageCount);
  const start = (currentPage - 1) * pageSize;
  host.querySelector('#boss-feed-pagination').hidden = pageCount === 1;
  const destinations = {first:1,previous:Math.max(1,currentPage - 1),next:Math.min(pageCount,currentPage + 1),last:pageCount};
  for (const [direction,destination] of Object.entries(destinations)) {
    const button = host.querySelector(`#boss-feed-${direction}-page`);
    button.value = String(destination);
    button.disabled = destination === currentPage;
  }
  const pageLabel = host.querySelector('#boss-feed-page-label');
  const label = t(`第 ${currentPage} / ${pageCount} 页`,`Page ${currentPage} of ${pageCount}`);
  if (pageLabel.textContent !== label) pageLabel.textContent = label;
  const status = host.querySelector('#boss-feed-results-status');
  status.textContent = error ? t('无法计算当前路线。请检查角色配置。','Could not calculate routes. Check your character settings.') : '';
  status.hidden = !status.textContent;
  const body = host.querySelector('tbody');
  body.innerHTML = filtered.slice(start,start + pageSize).map(row => {
    const open = expanded.has(row.key);
    const marker = {
      levelTooLow:t('等级不足','Level too low'),ineligible:t('不可投喂','Ineligible'),unknown:t('部分结果缺失','Partial estimate'),
    }[row.status];
    return `<tr data-boss-feed-row="${row.key}">
      <th scope="row"><button type="button" class="text-button boss-expand" data-expand="${row.key}" aria-expanded="${open}"${open ? ` aria-controls="boss-feed-detail-${row.key}"` : ''}><span aria-hidden="true">${open ? '▾' : '▸'}</span>
        <span><strong>${escape(name(row))}</strong> ${quality(row)}${marker ? `<small class="death-note" title="${escape(reasonText(row))}">${marker}</small>` : ''}</span></button></th>
      <td>${escape(feedingSkill(row))}</td><td>${kindLabel(row)}</td><td>${number(row.quantity)}</td>
      <td class="column-highlight">${compact(row.totalGold)}</td><td>${time(row.totalSeconds)}</td>
      ${boss.skills.map(key => `<td>${compact(row.xpBySkill[key])}</td>`).join('')}
      </tr>${open ? detail(row,columns.length) : ''}`;
  }).join('') || `<tr><td colspan="${columns.length}" class="empty-results">${t('没有符合当前设置的路线。','No routes match these settings.')}</td></tr>`;
  return currentPage;
}
