import {bossList,estimateRoutes,rarityCount,refreshRouteQuotes,valueRoutes} from './boss-feed-model.js';
import {importLabCharacter,normalizeCharacter,toolSlots} from './boss-feed-character.js';
import {renderBossAttributes,renderCharacterPanel} from './boss-feed-character-panel.js';
import {bossText,escape,option} from './boss-feed-copy.js';
import {categoryLabel,renderBossResults} from './boss-feed-results.js';
import {getSnapshot,subscribe} from './price-service.js';
import {bindSimulationPanel,pagePriceSettings,simulationPanel} from './page-prices.js';
import {characterImportPanel,importStatusText,probeCharacter,registerCharacterUpdates} from './import-controls.js';
import {worldBuffWarningText} from './world-buffs.js';

const storageKey = 'dvi-boss-feed-v1';
const strategies = {both:['直购+自制','Buy + craft'],buy:['仅直购','Buy only'],craft:['仅自制','Craft only']};
const bossIcons = {
  heart:'<path d="M5 21v-9a7 7 0 0 1 14 0v9H5Zm0-4h3m8 0h3M9 21v-6a3 3 0 0 1 6 0v6M4 21h16M12 12c-2-2 1-3 0-5 2 1 3 4 0 5Z"/>',
  kraken:'<path d="M6 13v-3a6 6 0 0 1 12 0v3M6 13c0 2-3 2-3 0m3 0c0 4 1 6 4 7m2-5v6m6-8c0 4-1 6-4 7m4-7c0 2 3 2 3 0M10 10h.01m4 0h.01"/>',
  colony:'<path d="M3 12a6 6 0 0 1 12 0H3Zm4 0v5a2 2 0 0 0 4 0v-5m2 4a4 4 0 0 1 8 0h-8Zm3 0v3a1 1 0 0 0 2 0v-3M7 9h.01m3-1h.01"/>',
  blight:'<path d="M11 21V9a4 4 0 0 1 4-4h2m-6 13c-4 0-6-2-6-5 3 0 5 1 6 3m0 4c3 0 5-2 6-5-3 0-5 1-6 3m6-13c3 1 4 4 2 6-2-1-3-3-2-6Zm0 0c-2 1-3 3-2 5"/>',
  siege:'<path d="M3 21V8h3v3h3V8h6v3h3V8h3v13H3Zm6 0v-4a3 3 0 0 1 6 0v4M5 14h1m12 0h1M12 8V3l4 1-4 2"/>',
};
const qualityOptions = Array.from({length:rarityCount},(_,tier) => String(tier));
const defaultSort = {key:'totalGold',ascending:true};
const record = value => value && typeof value === 'object' && !Array.isArray(value);
let host,language,loadFailed = false,saveFailed = false,dirty = true;
let calculationError = false,rows = [];
let estimate, valuation, repaintRequested = false;
let importBusy = false,importStatus = null;
let frame;

function readSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? '{}');
    if (record(saved)) return saved;
  } catch (error) {
    console.warn('Could not load boss feeding settings',error);
  }
  loadFailed = true;
  return {};
}

function bossCategories(boss, skill) {
  const categories = [...new Set(boss.classes.filter(group => !skill || group.skill === skill).map(group => group.cls))];
  return skill ? categories : [...categories,'essence'];
}

function normalizeFilters(filters, boss) {
  const skill = boss.skills.includes(filters?.skill) ? filters.skill : '';
  return {
    search:typeof filters?.search === 'string' ? filters.search : '',
    qualities:Array.isArray(filters?.qualities) ? qualityOptions.filter(tier => filters.qualities.includes(tier)) : ['0','1'],
    strategy:Object.hasOwn(strategies,filters?.strategy) ? filters.strategy : 'both',
    skill,
    category:bossCategories(boss,skill).includes(filters?.category) ? filters.category : '',
    minimumSupply:Number.isSafeInteger(filters?.minimumSupply) && filters.minimumSupply >= 0 ? filters.minimumSupply : null,
    eligibleOnly:filters?.eligibleOnly !== false,
  };
}

const saved = readSettings();
let boss = bossList.find(entry => entry.id === saved.bossId) ?? bossList[0];
let config = normalizeCharacter(saved.character);
let dailyProfit = Number.isFinite(saved.dailyProfit) && saved.dailyProfit >= 0 ? saved.dailyProfit : 0;
const bossSettings = Object.fromEntries(bossList.map(entry => {
  const value = saved.bossSettings?.[entry.id];
  return [entry.id,{
    fire:value?.fire !== false,
    chargeCraftTime:value?.chargeCraftTime !== false,
    filters:normalizeFilters(value?.filters,entry),
  }];
}));
let sort = defaultSort;
let resultPage = 1;
const expanded = new Set();
const settings = () => bossSettings[boss.id];
const find = id => host.querySelector('#boss-feed-' + id);

function save() {
  try {
    localStorage.setItem(storageKey,JSON.stringify({bossId:boss.id,dailyProfit,bossSettings,character:config}));
    loadFailed = saveFailed = false;
  } catch (error) {
    saveFailed = true;
    console.warn('Could not save boss feeding settings',error);
  }
  paintStorage();
  return !saveFailed;
}

function paintStorage() {
  const {text:t} = bossText(language);
  find('storage').textContent = saveFailed ? t('浏览器存储不可用，配置无法保存。','Browser storage is unavailable. Settings could not be saved.')
    : loadFailed ? t('已保存的配置无法读取，当前使用默认配置。','Saved settings could not be read. Showing defaults.')
      : t('● 技能首领配置独立保存在此浏览器','● Skilling boss settings saved separately in this browser');
}

function paintResults() {
  resultPage = renderBossResults(find('comparison'),{boss,language,rows,settings:settings(),sort,expanded,
    error:calculationError,page:resultPage});
}

function calculate(forcePaint = false) {
  const previousRows = rows;
  const previousError = calculationError;
  try {
    const {fire,chargeCraftTime} = settings();
    if (estimate?.boss !== boss || estimate.config !== config || estimate.fire !== fire) {
      estimate = {boss,config,fire,...estimateRoutes({bossId:boss.id,config,settings:{fire}})};
    }
    const snapshot = getSnapshot();
    const materialSource = pagePriceSettings('boss-feed').values.materials;
    if (estimate.snapshot !== snapshot || estimate.materialSource !== materialSource) {
      estimate.quotes = refreshRouteQuotes(estimate.materialIds,snapshot,estimate.quotes,materialSource);
      estimate.snapshot = snapshot;
      estimate.materialSource = materialSource;
    }
    if (valuation?.estimate !== estimate || valuation.quotes !== estimate.quotes ||
        valuation.dailyProfit !== dailyProfit || valuation.chargeCraftTime !== chargeCraftTime) {
      rows = valueRoutes(estimate.routes,estimate.quotes,{dailyProfit,chargeCraftTime});
      valuation = {estimate,quotes:estimate.quotes,dailyProfit,chargeCraftTime};
    }
    calculationError = false;
  } catch (error) {
    estimate = valuation = undefined;
    rows = [];
    calculationError = true;
    console.error(error);
  }
  const shouldPaint = forcePaint || repaintRequested || previousRows !== rows || previousError !== calculationError;
  dirty = false;
  repaintRequested = false;
  if (shouldPaint) paintResults();
}

function scheduleCalculation(repaint = true) {
  dirty = true;
  repaintRequested ||= repaint;
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    if (host?.isConnected && !host.closest('[hidden]') && dirty) calculate();
  });
}

subscribe(change => { if (change.prices || change.market) scheduleCalculation(false); });

function paintAttributes() {
  renderBossAttributes(find('attributes'),config,boss,language);
}

function paintCharacter() {
  paintAttributes();
  renderCharacterPanel(find('character'),{config,boss,language,onChange(next) {
    config = next;
    paintAttributes();
    save();
    scheduleCalculation();
  }});
}

function warningLabel(warning, {text:t,skill}) {
  const [group,key] = warning.split('.');
  if (group === 'skills' || group === 'masteries') {
    return group === 'skills' ? t(`${skill(key)}等级`,`${skill(key)} level`) : t(`${skill(key)}精通`,`${skill(key)} masteries`);
  }
  const toolSkill = Object.keys(toolSlots).find(name => toolSlots[name] === key);
  if (group === 'equipment' && toolSkill) return t(`${skill(toolSkill)}工具`,`${skill(toolSkill)} tool`);
  const labels = {
    equipment:['共用装备','Shared equipment'], brews:['药水','Potions'], house:['家园','Home'],
    perks:['特权','Perks'], guildBonus:['公会经验','Guild XP'], blessing:['矿脉祝福','Vein Blessing'],
    bossMarks:['首领印记','Boss marks'],
  };
  return t(...labels[group]);
}

function paintImport() {
  if (!host?.isConnected) return;
  const copy = bossText(language), {text:t} = copy;
  find('import').disabled = importBusy;
  const status = find('import-status');
  status.textContent = importStatusText(language,importStatus,importBusy);
  if (importBusy || !importStatus?.warnings?.length) return;
  const lines = [];
  const world = importStatus.warnings.find(key => ['worldBuffs.upgrade','weeklyXp.reset'].includes(key));
  const warnings = new Set(importStatus.warnings.filter(warning => {
    if (warning === world) return false;
    if (importStatus.bossId === boss.id) return true;
    const [group,key] = warning.split('.');
    return group !== 'house' && !(group === 'equipment' && Object.values(toolSlots).includes(key));
  }).map(key => warningLabel(key,copy)));
  if (warnings.size) lines.push(t(`请核对${[...warnings].join('、')}。`,`Check ${[...warnings].join(', ')}.`));
  if (world) lines.push(worldBuffWarningText(language,world,{rarity:false}));
  status.textContent += '\n' + lines.join('\n');
}

const updater = registerCharacterUpdates('boss-feed',{
  reportSuccessfulImport:false,
  importSkill:() => boss.id,
  revision:() => config,
  onBusy:value => { importBusy = value; paintImport(); },
  onError:error => { importStatus = {error:error.message}; paintImport(); },
  apply:(snapshot,{sameAutomaticCapture}) => {
    const result = importLabCharacter(snapshot,config,boss.skills,{sameAutomaticCapture});
    config = result.config;
    importStatus = {...result,bossId:boss.id,capturedAt:snapshot.capturedAt};
    paintCharacter();
    scheduleCalculation();
    return save();
  },
});
probeCharacter().then(() => { importStatus ??= {ready:true}; }).catch(error => {
  importStatus ??= {error:error.message};
}).finally(paintImport);

function paintCategoryFilter(filters) {
  const {text:t} = bossText(language);
  find('category').innerHTML = option('',t('全部分类','All groups')) +
    bossCategories(boss,filters.skill).map(key => option(key,categoryLabel(key,t))).join('');
  find('category').value = filters.category;
}

function paintBossSettings() {
  const {text:t,named,skill} = bossText(language);
  const current = settings(), {filters} = current;
  find('boss-badge').textContent = named(boss.label,boss.name);
  for (const button of find('picker').querySelectorAll('button')) {
    const selected = Number(button.value) === boss.id;
    button.setAttribute('aria-pressed',String(selected));
    button.classList.toggle('selected',selected);
  }
  paintFilterButtons(find('quality'),filters.qualities);
  find('strategy').value = filters.strategy;
  find('fire').checked = current.fire;
  find('charge-craft-time').checked = current.chargeCraftTime;
  find('search').value = filters.search;
  find('skill').innerHTML = option('',t('全部技能','All skills')) +
    boss.skills.map(key => option(key,skill(key))).join('');
  find('skill').value = filters.skill;
  paintCategoryFilter(filters);
  find('supply').value = filters.minimumSupply ?? '';
  find('eligible').checked = filters.eligibleOnly;
  paintCharacter();
}

function paintFilterButtons(group,selected) {
  for (const button of group.querySelectorAll('button')) {
    const pressed = selected.includes(button.value);
    button.setAttribute('aria-pressed',String(pressed));
    button.classList.toggle('selected',pressed);
  }
}

function wireControls() {
  find('picker').onclick = event => {
    const button = event.target.closest('button');
    if (!button || Number(button.value) === boss.id) return;
    boss = bossList.find(entry => entry.id === Number(button.value));
    resultPage = 1;
    if (sort.key.startsWith('xp:') && !boss.skills.includes(sort.key.slice(3))) sort = defaultSort;
    expanded.clear();
    updater.invalidate();
    paintBossSettings();
    paintImport();
    save();
    scheduleCalculation();
  };
  find('daily-profit').oninput = event => {
    const field = event.target;
    const amount = field.value === '' ? 0 : field.valueAsNumber * 1e6;
    if (!field.validity.valid || !Number.isFinite(amount)) return;
    dailyProfit = amount;
    save();
    scheduleCalculation();
  };
  find('import').onclick = () => updater.read();
  find('reset').onclick = () => {
    updater.reset();
    config = normalizeCharacter();
    importStatus = null;
    paintImport();
    paintCharacter();
    save();
    scheduleCalculation();
  };
  const quality = find('quality');
  quality.onclick = event => {
    const button = event.target.closest('button');
    if (!button) return;
    const filters = settings().filters;
    filters.qualities = filters.qualities.includes(button.value)
      ? filters.qualities.filter(value => value !== button.value) : [...filters.qualities,button.value];
    paintFilterButtons(quality,filters.qualities);
    save();
    resultPage = 1;
    paintResults();
  };
  for (const [id,key] of [['fire','fire'],['charge-craft-time','chargeCraftTime']]) {
    find(id).onchange = event => {
      settings()[key] = event.target.checked;
      save();
      resultPage = 1;
      scheduleCalculation();
    };
  }
  function updateFilters(event) {
    const supply = find('supply');
    if (event.target === supply && !supply.validity.valid) return;
    const filters = normalizeFilters({
      ...settings().filters,search:find('search').value,category:find('category').value,strategy:find('strategy').value,
      skill:find('skill').value,
      minimumSupply:supply.validity.valid ? supply.valueAsNumber : settings().filters.minimumSupply,
      eligibleOnly:find('eligible').checked,
    },boss);
    settings().filters = filters;
    if (event.target === find('skill')) paintCategoryFilter(filters);
    save();
    resultPage = 1;
    paintResults();
  }
  for (const id of ['search','supply']) find(id).oninput = updateFilters;
  for (const id of ['skill','category','eligible','strategy']) find(id).onchange = updateFilters;
  find('pagination').onclick = event => {
    const button = event.target.closest('button');
    if (!button) return;
    resultPage = Number(button.value);
    paintResults();
  };

  const comparison = find('comparison');
  comparison.onclick = event => {
    const sortButton = event.target.closest('[data-boss-feed-sort]');
    const expandButton = event.target.closest('[data-expand]');
    if (sortButton) {
      const key = sortButton.dataset.bossFeedSort;
      sort = {key,ascending:sort.key === key ? !sort.ascending : !key.startsWith('xp:')};
      resultPage = 1;
      paintResults();
      comparison.querySelector(`[data-boss-feed-sort="${key}"]`)?.focus({preventScroll:true});
    }
    if (expandButton) {
      const key = expandButton.dataset.expand;
      if (expanded.has(key)) expanded.delete(key);
      else expanded.add(key);
      paintResults();
      comparison.querySelector(`[data-expand="${key}"]`)?.focus({preventScroll:true});
    }
  };
}

function comparisonFilters({text:t,rarity}) {
  return `<div class="toolbar boss-filters">
    <div class="boss-filter-row">
      <div class="craft-search-filters">
        <div class="search-wrap"><img class="search-icon" src="/src/assets/search.svg" alt="" width="14" height="14"><input type="search" id="boss-feed-search" placeholder="${t('搜索物品名称（中 / 英）','Search items in English or Chinese')}" aria-label="${t('搜索投喂物品','Search feeding items')}" autocomplete="off"></div>
        <select id="boss-feed-skill" aria-label="${t('投喂技能','Feeding skill')}"></select>
        <select id="boss-feed-category" aria-label="${t('物品分类','Item group')}"></select>
      </div>
      <div class="presets craft-rarity-filters" id="boss-feed-quality" role="group" aria-label="${t('品质筛选','Rarity filter')}">
        ${qualityOptions.map(tier => `<button type="button" value="${tier}">${rarity(Number(tier))}</button>`).join('')}
      </div>
    </div>
    <div class="boss-filter-row">
      <select id="boss-feed-strategy" aria-label="${t('自制策略','Preparation strategy')}">
        ${Object.entries(strategies).map(([kind,label]) => option(kind,t(...label))).join('')}
      </select>
      <label class="boss-inline-field"><span>${t('市场卖单量 >','Market sell quantity >')}</span><input type="number" id="boss-feed-supply" min="0" max="${Number.MAX_SAFE_INTEGER}" step="1" placeholder="${t('不限','Any')}"></label>
      <label class="check"><input type="checkbox" id="boss-feed-eligible"><span>${t('只看等级符合','Eligible levels only')}</span></label>
      <label class="check"><input id="boss-feed-fire" type="checkbox"><span>${t('使用经验炉火','Use XP fire')}</span></label>
      <label class="check"><input id="boss-feed-charge-craft-time" type="checkbox"><span>${t('自制计算时间成本','Charge crafting time')}</span></label>
    </div>
  </div>`;
}

export function renderBossFeed(nextLanguage) {
  const target = document.getElementById('boss-feed-content');
  if (target === host && language === nextLanguage) {
    if (dirty) calculate();
    return;
  }
  const openDetails = new Map([...host?.querySelectorAll('details[id]') ?? []].map(node => [node.id,node.open]));
  host = target;
  language = nextLanguage;
  const copy = bossText(language), {text:t,named} = copy;
  host.innerHTML = `<div class="config-column"><aside class="panel config gather-config">
    <div class="panel-heading"><h1>${t('角色配置','Character build')}</h1><button class="text-button" type="button" id="boss-feed-reset">${t('清空配置','Reset settings')}</button></div>
    <p class="muted intro">${t('配置角色，对比技能首领投喂物品的性价比','Configure your character and compare feeding items for skilling bosses.')}</p>
    ${characterImportPanel(language,{id:'boss-feed-import-settings',statusId:'boss-feed-import-status',buttons:[{id:'boss-feed-import',label:t('导入配置','Import configuration')}]})}
    <div class="presets gather-skills" id="boss-feed-picker" role="group" aria-label="${t('首领','Boss')}">
      ${bossList.map(entry => `<button type="button" value="${entry.id}"><span aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${bossIcons[entry.key]}</svg></span>${escape(named(entry.label,entry.name))}</button>`).join('')}
    </div>
    <div>
      <label class="number-field"><span>${t('时间金币参数（M 金币／天）','Time-to-coin rate (M coins/day)')}</span><input id="boss-feed-daily-profit" type="number" min="0" step="any" value="${dailyProfit / 1e6}" aria-describedby="boss-feed-daily-profit-note"></label>
      <p class="micro" id="boss-feed-daily-profit-note">${t('用于将时间成本换算成金币成本','Converts time costs into coin costs')}</p>
    </div>
    <div id="boss-feed-character"></div>
    <p class="save-note" role="status" id="boss-feed-storage"></p>
  </aside>${simulationPanel('boss-feed',language)}</div><div class="results" id="boss-feed-results">
    <div class="result-heading"><div><span class="eyebrow" lang="en">SKILLING BOSSES FEEDING OVERVIEW</span><h2 id="boss-feed-title">${t('生效角色配置','Effective character build')}</h2></div><span class="style-badge" id="boss-feed-boss-badge"></span></div>
    <div class="boss-attribute-grid" id="boss-feed-attributes" role="group" aria-labelledby="boss-feed-title" tabindex="0"></div>
    <section class="panel enemies" id="boss-feed-comparison" aria-labelledby="boss-feed-comparison-title">
      <div class="enemies-heading boss-comparison-heading"><h2 id="boss-feed-comparison-title">${t('投喂物品性价比','Feeding item value')}</h2><span id="boss-feed-box-basis">${t('每100箱','Per 100 chests')}</span></div>
      ${comparisonFilters(copy)}
      <p class="table-note" id="boss-feed-results-status" role="status" hidden></p>
      <div class="table-scroll" tabindex="0" role="region" aria-labelledby="boss-feed-comparison-title"><table class="boss-feed-table"><thead></thead><tbody></tbody></table></div>
      <nav class="boss-pagination" id="boss-feed-pagination" aria-label="${t('投喂路线分页','Feeding route pages')}" hidden>
        <button class="secondary" type="button" id="boss-feed-first-page">${t('首页','First')}</button>
        <button class="secondary" type="button" id="boss-feed-previous-page">${t('上一页','Previous')}</button>
        <span id="boss-feed-page-label" role="status"></span>
        <button class="secondary" type="button" id="boss-feed-next-page">${t('下一页','Next')}</button>
        <button class="secondary" type="button" id="boss-feed-last-page">${t('末页','Last')}</button>
      </nav>
      <p class="table-note" id="boss-feed-method-note">${t(
        '投喂、补料和自制耗时均由<strong class="simulation-caveat">工时模型</strong>估算。自制只计算一层配方，金币成本包含采购额和按设置折算的收入损失。',
        'Feeding, restocking and crafting times are estimated with the <strong class="simulation-caveat">work-time model</strong>. Self-crafting covers one recipe layer. Coin cost includes purchases and income lost for the time charged in your settings.',
      )}</p>
    </section>
  </div>`;
  paintBossSettings();
  for (const node of host.querySelectorAll('details[id]')) {
    if (openDetails.has(node.id)) node.open = openDetails.get(node.id);
  }
  paintStorage();
  paintImport();
  wireControls();
  bindSimulationPanel('boss-feed',()=>scheduleCalculation(false));
  calculate(true);
}
