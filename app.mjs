export const categories = { board: '桌游', tcg: 'TCG', cards: '收藏卡' };
export const regions = { domestic: '中国大陆', overseas: '海外', global: '多语言 / 跨地区' };
export class DataValidationError extends Error {
  constructor(message) { super(message); this.name = 'DataValidationError'; }
}
const invalid = message => { throw new DataValidationError(message); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const validDate = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
export function safeSourceUrl(value) {
  if (!text(value) || value !== value.trim() || /[\u0000-\u0020\u007f\\]/.test(value) || !/^https:\/\//i.test(value)) invalid('来源链接必须是有效的绝对 HTTPS 地址');
  let url;
  try { url = new URL(value); } catch { invalid('来源链接地址格式不正确'); }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) invalid('来源链接必须使用 HTTPS，且不能包含账号或密码');
  return url.href;
}
export function validateItem(item) {
  if (!record(item)) invalid('资讯条目必须是对象');
  for (const field of ['id', 'category', 'region', 'label', 'title', 'brand', 'published', 'node', 'priority', 'summary', 'advice']) {
    if (!text(item[field])) invalid(`资讯字段 ${field} 必须是非空字符串`);
  }
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(item.id)) invalid('资讯 id 只能使用字母、数字、下划线或短横线，并以字母开头');
  if (!Object.hasOwn(categories, item.category)) invalid('资讯 category 必须是 board、tcg 或 cards');
  if (!Object.hasOwn(regions, item.region)) invalid('资讯 region 必须是 domestic、overseas 或 global');
  if (!Array.isArray(item.facts) || !item.facts.length || !item.facts.every(text)) invalid('资讯 facts 必须是非空字符串数组');
  if (!Array.isArray(item.sources) || !item.sources.length) invalid('资讯 sources 必须是非空来源数组');
  for (const source of item.sources) {
    if (!record(source) || !text(source.name)) invalid('每个来源必须包含非空 name 和有效 url');
    safeSourceUrl(source.url);
  }
  return item;
}
export function readArchive(payload) {
  if (!record(payload) || payload.schemaVersion !== 1 || !record(payload.issues) || !validDate(payload.latestIssue)
    || !Object.hasOwn(payload.issues, payload.latestIssue)) invalid('归档必须包含 schemaVersion: 1、有效 latestIssue 和 issues 对象');
  const dates = Object.keys(payload.issues).sort();
  if (dates.at(-1) !== payload.latestIssue) invalid('latestIssue 必须指向日期最新的一期');
  for (const [date, issue] of Object.entries(payload.issues)) {
    if (!validDate(date) || !record(issue) || issue.issue !== date) invalid('期号必须是有效日期，并与 issues 中的日期键一致');
    if (typeof issue.cutoff !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(issue.cutoff)) invalid('每期 cutoff 必须是有效 HH:mm 时间');
    if (issue.timezone !== 'Asia/Shanghai') invalid('每期 timezone 必须为 Asia/Shanghai');
    if (!Array.isArray(issue.coverage) || !issue.coverage.every(text)) invalid('每期 coverage 必须是字符串数组');
    if (!Array.isArray(issue.items) || !issue.items.length) invalid('每期 items 必须是非空资讯数组');
    issue.items.forEach(validateItem);
    const ids = new Set(issue.items.map(item => item.id));
    if (ids.size !== issue.items.length) invalid('同一期内的资讯 id 不能重复');
    if (!Array.isArray(issue.highlights) || issue.highlights.length !== 3 || new Set(issue.highlights).size !== 3
      || !issue.highlights.every(id => typeof id === 'string' && ids.has(id))) invalid('每期 highlights 必须引用当期三个不同的资讯 id');
  }
  return payload;
}
export function dataErrorMessage(error) {
  return error instanceof DataValidationError
    ? `数据校验失败：${error.message}。未显示资讯，请修正 data.json 后刷新。`
    : '资讯读取失败：无法读取或解析 data.json，请检查文件及 HTTP 访问后刷新。';
}
export function selectItems(items, { category = 'all', region = 'all', query = '' } = {}) {
  const term = query.trim().toLocaleLowerCase();
  return items.filter(item => (category === 'all' || item.category === category)
    && (region === 'all' || item.region === region)
    && (!term || [item.title, item.brand, item.summary, item.published, item.node, item.advice, ...item.facts].join(' ').toLocaleLowerCase().includes(term)));
}
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function articleMarkup(item) {
  validateItem(item);
  return `<article class="article" id="${escape(item.id)}"><div class="article-top"><span class="category category-${escape(item.category)}">${categories[item.category]}</span><span class="news-label">${escape(item.label)}</span><span class="region">${regions[item.region]}</span></div><p class="brand">${escape(item.brand)}</p><h3>${escape(item.title)}</h3><p class="summary-text">${escape(item.summary)}</p><div class="timeline"><div><span>发布时间</span><p>${escape(item.published)}</p></div><div><span>关键节点</span><p>${escape(item.node)}</p></div></div><details><summary><span>事实、建议与原文来源</span><span class="detail-icon" aria-hidden="true">+</span></summary><div class="detail-body"><h4><span class="fact-dot"></span>事实 / 提供资料</h4><ul class="facts">${item.facts.map(f => `<li>${escape(f)}</li>`).join('')}</ul><div class="advice"><h4>经营建议 <span>编辑判断</span></h4><p>${escape(item.advice)}</p></div><h4 class="sources-title">原文来源</h4><div class="sources">${item.sources.map(s => `<a href="${escape(safeSourceUrl(s.url))}" target="_blank" rel="noopener noreferrer">${escape(s.name)} <span aria-hidden="true">↗</span></a>`).join('')}</div></div></details></article>`;
}
if (typeof document !== 'undefined') {
  const state = { category: 'all', region: 'all', query: '' };
  const byId = id => document.getElementById(id);
  let data, archive;
  function render() {
    const items = selectItems(data.items, state);
    byId('articles').innerHTML = items.map(articleMarkup).join('');
    byId('result-count').textContent = `显示 ${items.length} / ${data.items.length} 条 · ${data.issue.replaceAll('-', '.')}`;
    byId('empty').hidden = items.length > 0;
    document.querySelectorAll('[data-category]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.category === state.category)));
  }
  function reset() {
    Object.assign(state, { category: 'all', region: 'all', query: '' });
    byId('region').value = 'all'; byId('search').value = ''; render();
  }
  function renderEdition(date) {
    data = archive.issues[date];
    const dates = Object.keys(archive.issues).sort();
    const number = dates.indexOf(date) + 1;
    const pad = value => String(value).padStart(2, '0');
    const parsed = new Date(`${date}T12:00:00+08:00`);
    document.title = `Gambit Daily — ${date.replaceAll('-', '.')} 行业简报`;
    document.querySelector('.header-note > span:last-child').textContent = `ISSUE ${String(number).padStart(3, '0')}`;
    document.querySelector('.issue-kicker').innerHTML = `${date === archive.latestIssue ? 'LATEST EDITION' : 'ARCHIVE EDITION'} <span>${pad(number)} / ${pad(dates.length)}</span>`;
    document.querySelector('.date-number').innerHTML = `${escape(date.slice(8))}<span>${parsed.toLocaleDateString('en-US', { month: 'short', timeZone: 'Asia/Shanghai' }).toUpperCase()}<br>${escape(date.slice(0, 4))}</span>`;
    document.querySelector('.issue-bottom > span').textContent = `${parsed.toLocaleDateString('zh-CN', { weekday: 'long', timeZone: 'Asia/Shanghai' })} · 北京时间`;
    document.querySelector('.issue-bottom > strong').textContent = `截至 ${data.cutoff}`;
    document.querySelector('.issue-stats').innerHTML = `<span><b>${pad(data.items.length)}</b> 条精选</span><span><b>${pad(new Set(data.items.map(i => i.category)).size)}</b> 个行业</span><span><b>${pad(dates.length)}</b> 期归档</span>`;
    document.querySelector('footer p').innerHTML = `${escape(date.replaceAll('-', '.'))} · 截至北京时间 ${escape(data.cutoff)}<br>按提供资料整理 · 原文链接供复核 · 经营建议为编辑判断`;
    byId('highlights-title').textContent = date === archive.latestIssue ? '今日重点' : '归档重点';
    document.querySelectorAll('[data-category]').forEach(button => {
      button.querySelector('span').textContent = selectItems(data.items, { category: button.dataset.category }).length;
    });
    byId('highlights').innerHTML = data.highlights.map((id, index) => {
      const item = data.items.find(i => i.id === id);
      return `<a class="highlight" href="#${escape(id)}" data-highlight="${escape(id)}"><div class="highlight-top"><span>0${index + 1}</span><span>${escape(item.priority)}</span><span aria-hidden="true">↗</span></div><h3>${escape(item.title)}</h3><p>${escape(item.summary)}</p><div class="highlight-bottom"><span>${escape(item.label)}</span><span>${categories[item.category]}</span></div></a>`;
    }).join('');
    byId('coverage').innerHTML = data.coverage.map(c => `<li>${escape(c)}</li>`).join('');
    reset();
  }
  async function init() {
    try {
      const response = await fetch(new URL('./data.json', import.meta.url));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      archive = readArchive(await response.json());
      const dates = Object.keys(archive.issues).sort().reverse();
      byId('issue').innerHTML = dates.map(date => `<option value="${escape(date)}">${escape(date.replaceAll('-', '.'))}${dates.length === 1 ? ' · 唯一一期' : date === archive.latestIssue ? ' · 最新一期' : ''}</option>`).join('');
      byId('issue').value = archive.latestIssue;
      byId('issue').addEventListener('change', event => renderEdition(event.target.value));
      byId('categories').addEventListener('click', event => {
        const button = event.target.closest('[data-category]');
        if (button) { state.category = button.dataset.category; render(); }
      });
      byId('region').addEventListener('change', event => { state.region = event.target.value; render(); });
      byId('search').addEventListener('input', event => { state.query = event.target.value; render(); });
      byId('reset').addEventListener('click', reset);
      byId('empty-reset').addEventListener('click', reset);
      byId('highlights').addEventListener('click', event => {
        const link = event.target.closest('[data-highlight]');
        if (!link) return;
        reset();
        const article = byId(link.dataset.highlight);
        article.querySelector('details').open = true;
        article.setAttribute('tabindex', '-1'); article.focus({ preventScroll: true });
      });
      renderEdition(archive.latestIssue);
    } catch (error) {
      byId('result-count').textContent = '本期资讯未显示：数据读取或校验失败。';
      byId('highlights').replaceChildren();
      byId('coverage').replaceChildren();
      byId('empty').hidden = true;
      const notice = document.createElement('p');
      notice.className = 'empty'; notice.setAttribute('role', 'alert');
      notice.textContent = dataErrorMessage(error);
      byId('articles').replaceChildren(notice);
      document.querySelectorAll('#categories button, #issue, #region, #search, #reset').forEach(control => { control.disabled = true; });
      console.error('Gambit data loading failed', error);
    }
  }
  init();
}
