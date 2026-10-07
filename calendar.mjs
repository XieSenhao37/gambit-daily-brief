import { categories, safeSourceUrl, DataValidationError } from './app.mjs';
export const nodeTypes = { release: '正式发售', preorder: '预售开启', crowdfunding: '众筹开启', prerelease: '售前活动' };
export const evidenceLevels = { official: '官方来源', secondary: '专业媒体', tentative: '日期待定', conflict: '来源冲突', unverified: '待核实' };
const fail = message => { throw new DataValidationError(message); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export const validMonth = value => typeof value === 'string' && validDate(`${value}-01`);
export function beijingToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = type => parts.find(p => p.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function validateCalendarEvent(event) {
  if (!record(event)) fail('日历事件必须是对象');
  for (const field of ['id', 'product', 'category', 'brand', 'region']) if (!text(event[field])) fail(`日历事件 ${field} 必须是非空字符串`);
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,99}$/.test(event.id)) fail('日历事件 id 格式不正确');
  if (!Object.hasOwn(categories, event.category) || (event.nodeType !== null && !Object.hasOwn(nodeTypes, event.nodeType))) fail('日历行业或节点类型不正确');
  if (!Object.hasOwn(evidenceLevels, event.evidenceLevel) || !text(event.announcementStatus) || !text(event.sourceEvidence)) fail('日历必须分别标注证据级别、来源状态和日期依据');
  if (event.nodeType === null && !['conflict', 'unverified'].includes(event.evidenceLevel)) fail('仅待核实事件可保留未知节点类型');
  if (event.sourceTimezone !== null && !text(event.sourceTimezone)) fail('sourceTimezone 必须是原始时区说明或 null');
  if (event.sourceTime !== null && !text(event.sourceTime)) fail('sourceTime 必须是原始时间说明或 null');
  if (event.pendingReleaseEvidence !== undefined && (!text(event.pendingReleaseEvidence) || event.nodeType !== 'preorder' || event.date === null)) fail('正式发售待定说明仅用于有明确预售日期及来源依据的预售记录');
  if (event.date !== null && !validDate(event.date)) fail('日历 date 必须是有效原始日期或 null');
  if (event.endDate !== null && (!validDate(event.endDate) || event.date === null || event.endDate < event.date)) fail('日历 endDate 必须为空或不早于开始日期');
  if (event.announcedMonth !== null && (!validMonth(event.announcedMonth) || event.date !== null)) fail('announcedMonth 仅用于已知月份、日期待定的事件');
  if (!Array.isArray(event.languages) || !event.languages.length || !event.languages.every(text)) fail('日历 languages 必须是非空字符串数组；未知语言请明确标注');
  if (!Array.isArray(event.notes) || !event.notes.every(text)) fail('日历 notes 必须是字符串数组');
  if (!Array.isArray(event.sources) || !event.sources.length) fail('每个日历事件必须有原文来源');
  for (const source of event.sources) {
    if (!record(source) || !text(source.name)) fail('日历来源必须包含 name 和 url');
    safeSourceUrl(source.url);
  }
  if (event.timing !== null) {
    const timing = event.timing;
    if (event.date === null || !record(timing) || !text(timing.evidence) || typeof timing.localTime !== 'string'
      || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(timing.localTime) || typeof timing.utcOffset !== 'string'
      || !/^[+-](?:0\d|1[0-4]):[0-5]\d$/.test(timing.utcOffset)
      || Number(timing.utcOffset.slice(1, 3)) * 60 + Number(timing.utcOffset.slice(4)) > 840
      || event.sourceTime !== timing.localTime || !text(event.sourceTimezone)) fail('精确时间必须有原始日期、HH:mm、有效 UTC 偏移及来源证据；否则 timing 为 null');
  }
  return event;
}
export function readCalendar(payload) {
  if (!record(payload) || payload.schemaVersion !== 1 || !['pending', 'ready'].includes(payload.status)
    || !validDate(payload.asOf) || !Array.isArray(payload.coverage) || !payload.coverage.every(text)
    || !Array.isArray(payload.events) || !Array.isArray(payload.review) || !Array.isArray(payload.coverageSources)) fail('日历必须包含 schemaVersion: 1、status、有效 asOf、coverage、coverageSources、events 和 review 数组');
  const all = [...payload.events, ...payload.review]; all.forEach(validateCalendarEvent);
  if (new Set(all.map(e => e.id)).size !== all.length) fail('日历事件 id 不能重复');
  if (payload.events.some(e => ['conflict', 'unverified'].includes(e.evidenceLevel) || e.nodeType === null)) fail('来源冲突与类型待核事件只能放入 review，不能进入月历');
  if (payload.review.some(e => !['conflict', 'unverified'].includes(e.evidenceLevel))) fail('review 仅用于待核实或来源冲突的记录');
  for (const source of payload.coverageSources) { if (!record(source) || !text(source.name)) fail('覆盖来源必须包含 name 和 url'); safeSourceUrl(source.url); }
  if (payload.status === 'pending' && payload.events.length) fail('待整理状态不能包含已发布事件');
  return payload;
}
export function filterEvents(events, { category = 'all', nodeType = 'all', brand = 'all' } = {}) {
  return events.filter(e => (category === 'all' || e.category === category) && (nodeType === 'all' || e.nodeType === nodeType) && (brand === 'all' || e.brand === brand));
}
export function eventsOnDate(events, date) { return events.filter(e => e.date !== null && e.date <= date && (e.endDate ?? e.date) >= date); }
export function eventsInMonth(events, month) {
  const start = `${month}-01`, end = monthGrid(month).filter(d => d.inMonth).at(-1).date;
  return events.filter(e => e.date !== null && e.date <= end && (e.endDate ?? e.date) >= start);
}
export function tbaEvents(events, month) {
  const records = events.filter(e => e.date === null);
  for (const event of events.filter(e => text(e.pendingReleaseEvidence))) {
    records.push({ ...event, id: `${event.id}-release-tba`, nodeType: 'release', date: null, endDate: null, announcedMonth: null,
      timing: null, sourceTime: null, evidenceLevel: 'tentative', announcementStatus: '正式发售日期未公布',
      pendingReleaseEvidence: undefined, sourceEvidence: event.pendingReleaseEvidence,
      notes: [`已公布的预售日期为 ${event.date}；正式发售日期仍待公布。`, ...event.notes] });
  }
  return records.filter(e => e.announcedMonth === null || e.announcedMonth === month);
}
export function upcomingReleases(events, today, limit = 5) {
  return events.filter(e => e.nodeType === 'release' && e.date !== null && (e.endDate ?? e.date) >= today).sort((a, b) => a.date.localeCompare(b.date) || a.product.localeCompare(b.product)).slice(0, limit);
}
export function shiftMonth(month, amount) {
  if (!validMonth(month)) fail('月份格式不正确');
  const date = new Date(`${month}-01T00:00:00Z`); date.setUTCMonth(date.getUTCMonth() + amount);
  const result = date.toISOString().slice(0, 7); return validMonth(result) ? result : null;
}
export function monthGrid(month) {
  if (!validMonth(month)) fail('月份格式不正确');
  const first = new Date(`${month}-01T00:00:00Z`);
  const offset = (first.getUTCDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(first); date.setUTCDate(1 + index - offset);
    const iso = date.toISOString().slice(0, 10);
    return { date: iso, day: date.getUTCDate(), inMonth: iso.startsWith(month) };
  });
}
export function beijingTime(event) {
  validateCalendarEvent(event);
  if (event.timing === null) return null;
  const instant = new Date(`${event.date}T${event.timing.localTime}:00${event.timing.utcOffset}`);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instant);
  const part = type => parts.find(p => p.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}`;
}
export function eventMarkup(event, compact = false, review = false) {
  validateCalendarEvent(event);
  const date = event.date === null ? (event.announcedMonth ? `${event.announcedMonth} · 日待定` : '日期待公布') : `${event.date}${event.endDate && event.endDate !== event.date ? ` 至 ${event.endDate}` : ''}`;
  const time = beijingTime(event);
  return `<article class="calendar-event cal-${event.category}"><div class="calendar-event-meta"><span class="calendar-node">${review ? '待核实记录' : nodeTypes[event.nodeType]}</span><span>${categories[event.category]} · ${esc(event.brand)}</span><span class="calendar-evidence">${evidenceLevels[event.evidenceLevel]}</span></div><h4>${esc(event.product)}</h4><p class="calendar-event-date">${esc(date)} <span>${review ? '来源报告日期，尚待复核' : '来源日期'}${event.date && (event.endDate ?? event.date) < beijingToday() ? ' · 日期已过' : ''}</span></p><p class="calendar-event-region">${esc(event.region)} · ${esc(event.languages.join(' / '))}</p>${compact ? '' : `<p class="calendar-time-note">原始时区说明：${esc(event.sourceTimezone ?? '未提供')}${event.sourceTime ? ` · 原始时间：${esc(event.sourceTime)}` : ''}</p>${time ? `<div class="calendar-time"><p>来源时间：${esc(event.date)} ${esc(event.timing.localTime)}（UTC${esc(event.timing.utcOffset)}）</p><p>北京时间：${esc(time)}</p><p>时间依据：${esc(event.timing.evidence)}</p></div>` : '<p class="calendar-time-note">无可换算的精确时刻，不推算北京时间。</p>'}<p class="calendar-time-note">日期依据：${esc(event.sourceEvidence)}</p><ul class="calendar-notes">${event.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul><div class="sources">${event.sources.map(s => `<a href="${esc(safeSourceUrl(s.url))}" target="_blank" rel="noopener noreferrer">${esc(s.name)} ↗</a>`).join('')}</div>`}</article>`;
}
if (typeof document !== 'undefined' && document.getElementById('release-calendar')) {
  const byId = id => document.getElementById(id);
  const today = beijingToday();
  const state = { month: today.slice(0, 7), selected: today, category: 'all', nodeType: 'release', brand: 'all' };
  let data;
  const empty = message => `<p class="calendar-empty">${esc(message)}</p>`;
  function render() {
    const filtered = filterEvents(data.events, state), monthly = eventsInMonth(filtered, state.month);
    byId('cal-month-title').textContent = `${Number(state.month.slice(0, 4))} 年 ${Number(state.month.slice(5))} 月`;
    byId('cal-month').value = state.month;
    byId('cal-status').textContent = data.status === 'pending' ? '日历数据正在整理 · 空白不代表没有节点' : `本月 ${monthly.length} 个已收录节点 · 来源日期口径 · 今日按北京时间高亮`;
    const cells = monthGrid(state.month);
    let grid = '<div class="calendar-weekdays" role="row" aria-rowindex="1">' + ['一', '二', '三', '四', '五', '六', '日'].map(d => `<span role="columnheader">${d}</span>`).join('') + '</div>';
    for (let row = 0; row < 6; row++) {
      grid += `<div class="calendar-week" role="row" aria-rowindex="${row + 2}">`;
      for (const cell of cells.slice(row * 7, row * 7 + 7)) {
        if (!cell.inMonth) { grid += '<div class="calendar-padding" aria-hidden="true"></div>'; continue; }
        const events = eventsOnDate(filtered, cell.date);
        const aria = `${cell.date}${cell.date === today ? '，北京时间今日' : ''}，${events.length} 个节点${events.length ? '：' + events.map(e => `${nodeTypes[e.nodeType]} ${e.product}`).join('；') : ''}`;
        grid += `<button type="button" role="gridcell" aria-colindex="${cells.indexOf(cell) % 7 + 1}" class="calendar-cell${cell.date === today ? ' is-today' : ''}${cell.date === state.selected ? ' is-selected' : ''}" data-calendar-date="${cell.date}" aria-label="${esc(aria)}" aria-selected="${cell.date === state.selected}"${cell.date === today ? ' aria-current="date"' : ''} tabindex="${cell.date === state.selected ? '0' : '-1'}"><span class="calendar-day-number">${cell.day}${cell.date === today ? '<small>今</small>' : ''}</span><span class="calendar-cell-events">${events.slice(0, 2).map(e => `<span class="calendar-chip cal-${e.category}">${nodeTypes[e.nodeType]} · ${esc(e.product)}</span>`).join('')}${events.length > 2 ? `<span class="calendar-more">＋${events.length - 2} 个节点</span>` : ''}</span><span class="calendar-mobile-dots" aria-hidden="true">${[...new Set(events.map(e => e.category))].map(c => `<i class="cal-${c}"></i>`).join('')}${events.length ? `<small>${events.length}</small>` : ''}</span></button>`;
      }
      grid += '</div>';
    }
    byId('cal-grid').innerHTML = grid;
    const selected = eventsOnDate(filtered, state.selected);
    byId('cal-day-title').textContent = `${state.selected} · ${selected.length} 个节点`;
    byId('cal-day-events').innerHTML = selected.length ? selected.map(e => eventMarkup(e)).join('') : empty(data.status === 'pending' ? '本月数据正在整理，稍后可查看已核实产品节点。' : '当日暂无已收录节点。可以选择其他日期，或调整筛选。');
    const upcoming = upcomingReleases(filtered, today);
    byId('cal-upcoming').innerHTML = upcoming.length ? upcoming.map(e => `<div class="calendar-upcoming-item">${eventMarkup(e, true)}<button type="button" class="calendar-open" data-upcoming-date="${e.date}">查看当日详情 ↗</button></div>`).join('') : empty('当前筛选下暂无已收录的即将正式发售节点。');
    const tba = filterEvents(tbaEvents(data.events, state.month), state);
    byId('cal-tba').innerHTML = tba.length ? tba.map(e => eventMarkup(e)).join('') : empty('当前筛选下暂无已收录的日期待定产品。');
    const review = filterEvents(data.review, { ...state, nodeType: 'all' }).filter(e => e.date ? e.date.startsWith(state.month) : !e.announcedMonth || e.announcedMonth === state.month);
    byId('cal-review').innerHTML = review.length ? review.map(e => eventMarkup(e, false, true)).join('') : empty('当前月份和行业筛选下暂无待核实记录。');
  }
  function selectDate(date, focus = false) {
    if (!validDate(date)) return;
    state.month = date.slice(0, 7); state.selected = date; render();
    if (focus) byId('cal-grid').querySelector(`[data-calendar-date="${date}"]`).focus();
  }
  function changeMonth(month) { if (validMonth(month)) { state.month = month; state.selected = month === today.slice(0, 7) ? today : `${month}-01`; render(); } else byId('cal-month').value = state.month; }
  async function init() {
    try {
      const response = await fetch(new URL('./calendar.json', import.meta.url));
      if (!response.ok) throw new Error('Calendar HTTP error');
      data = readCalendar(await response.json());
      byId('cal-brand').innerHTML = '<option value="all">全部品牌 / 游戏</option>' + [...new Set([...data.events, ...data.review].map(e => e.brand))].sort().map(brand => `<option value="${esc(brand)}">${esc(brand)}</option>`).join('');
      byId('cal-asof').textContent = `数据核对截至 ${data.asOf} · ${data.status === 'pending' ? '待整理' : '已收录来源'}`;
      byId('cal-coverage').innerHTML = data.coverage.map(note => `<li>${esc(note)}</li>`).join('');
      byId('cal-coverage-sources').innerHTML = data.coverageSources.map(s => `<a href="${esc(safeSourceUrl(s.url))}" target="_blank" rel="noopener noreferrer">${esc(s.name)} ↗</a>`).join('');
      byId('cal-prev').addEventListener('click', () => changeMonth(shiftMonth(state.month, -1)));
      byId('cal-next').addEventListener('click', () => changeMonth(shiftMonth(state.month, 1)));
      byId('cal-today').addEventListener('click', () => selectDate(today));
      byId('cal-month').addEventListener('change', event => changeMonth(event.target.value));
      for (const [id, field] of [['cal-category', 'category'], ['cal-node', 'nodeType'], ['cal-brand', 'brand']]) byId(id).addEventListener('change', event => { state[field] = event.target.value; render(); });
      byId('cal-reset').addEventListener('click', () => { state.category = state.brand = 'all'; state.nodeType = 'release'; byId('cal-category').value = byId('cal-brand').value = 'all'; byId('cal-node').value = 'release'; render(); });
      byId('cal-grid').addEventListener('click', event => { const button = event.target.closest('[data-calendar-date]'); if (button) selectDate(button.dataset.calendarDate, true); });
      byId('cal-grid').addEventListener('keydown', event => {
        const button = event.target.closest('[data-calendar-date]'); if (!button) return;
        const date = new Date(`${button.dataset.calendarDate}T00:00:00Z`);
        const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -(date.getUTCDay() + 6) % 7, End: 6 - (date.getUTCDay() + 6) % 7 };
        if (Object.hasOwn(offsets, event.key)) { event.preventDefault(); date.setUTCDate(date.getUTCDate() + offsets[event.key]); selectDate(date.toISOString().slice(0, 10), true); }
        else if (['PageUp', 'PageDown'].includes(event.key)) { event.preventDefault(); changeMonth(shiftMonth(state.month, event.key === 'PageUp' ? -1 : 1)); byId('cal-grid').querySelector(`[data-calendar-date="${state.selected}"]`).focus(); }
      });
      byId('cal-upcoming').addEventListener('click', event => { const button = event.target.closest('[data-upcoming-date]'); if (button) { selectDate(button.dataset.upcomingDate); byId('cal-day-title').setAttribute('tabindex', '-1'); byId('cal-day-title').focus(); } });
      render();
    } catch (error) {
      byId('cal-status').textContent = '日历未显示：数据读取或校验失败。';
      for (const id of ['cal-grid', 'cal-upcoming', 'cal-tba', 'cal-review', 'cal-coverage', 'cal-coverage-sources']) byId(id).replaceChildren();
      const notice = document.createElement('p'); notice.className = 'calendar-empty'; notice.setAttribute('role', 'alert');
      notice.textContent = error instanceof DataValidationError ? `日历数据校验失败：${error.message}。请修正 calendar.json 后刷新。` : '无法读取或解析 calendar.json，请检查文件与 HTTP 访问后刷新。';
      byId('cal-day-events').replaceChildren(notice);
      document.querySelectorAll('.calendar-toolbar button, .calendar-toolbar input, .calendar-filters button, .calendar-filters select').forEach(control => { control.disabled = true; });
    }
  }
  init();
}
