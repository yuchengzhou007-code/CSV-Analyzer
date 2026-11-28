import { createWaferView } from './wafer.js';
import { frequencyText, metricLabel, metricNumber, metricTick, mountFrequencyUnit } from './frequency.js';

const ORDERS = { vt: ['SVT', 'LVTLL', 'LVT', 'ULVTLL', 'ULVT', 'ELVT'], function: ['INV', 'ND2', 'ND3', 'ND4', 'NR2', 'NR3', 'NR4'], drive: ['X1', 'X2', 'X4'] };
const PALETTE = ['#4878a8', '#38a6a5', '#59a14f', '#b49b27', '#b979ac', '#e07b54', '#8562a3'];
const DIMENSION_NAMES = { vt: 'VT', function: 'Function', drive: 'Drive', vdd_v: 'Voltage', cell_height: 'Cell height' };
const METRICS = { ratio: { field: 'silicon_sim_ratio', label: 'Frequency ratio · Measure / Simulation', ref: 1, digits: 4 }, frequency: { field: 'silicon_mean_frequency_mhz', label: 'Measure frequency (MHz)', ref: null, digits: 2 }, simulation: { field: 'simulation_frequency_mhz', label: 'Simulation frequency (MHz)', ref: null, digits: 2 }, deviation: { field: 'frequency_deviation_pct', label: 'Frequency deviation (%)', ref: 0, digits: 2 } };
const DEFAULTS = { group: 'vt', function: 'INV', vt: 'SVT', drive: 'X1', vdd_v: '0.8', metric: 'ratio', probability: 'normal' };
const state = { ...DEFAULTS, selected: '', hovered: '' };
const selectedGroups = {};
const groupSearches = {};
const get = id => document.getElementById(id);
const normalCDF = value => {
  const absolute = Math.abs(value), coefficient = 1 / (1 + 0.2316419 * absolute);
  const tail = Math.exp(-absolute * absolute / 2) / Math.sqrt(2 * Math.PI) * coefficient * (0.319381530 + coefficient * (-0.356563782 + coefficient * (1.781477937 + coefficient * (-1.821255978 + coefficient * 1.330274429))));
  return value >= 0 ? 1 - tail : tail;
};
function normalQuantile(probability) {
  let low = -8, high = 8;
  for (let iteration = 0; iteration < 65; iteration++) {
    const middle = (low + high) / 2;
    if (normalCDF(middle) < probability) low = middle; else high = middle;
  }
  return (low + high) / 2;
}
function quantile(values, probability) {
  const position = (values.length - 1) * probability, floor = Math.floor(position);
  return values[floor] + (values[Math.min(floor + 1, values.length - 1)] - values[floor]) * (position - floor);
}
function summarize(records) {
  const metric = METRICS[state.metric];
  const sorted = [...records].sort((first, second) => first[metric.field] - second[metric.field] || first.die_id.localeCompare(second.die_id));
  const values = sorted.map(row => row[metric.field]);
  const mean = values[0] + values.reduce((sum, value) => sum + (value - values[0]), 0) / values.length;
  const deviation = values.length > 1 ? Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)) : null;
  const q1 = quantile(values, 0.25), q3 = quantile(values, 0.75), iqr = q3 - q1;
  return { records: sorted, values, mean, deviation, q1, q3, median: quantile(values, 0.5), p10: quantile(values, 0.1), p90: quantile(values, 0.9),
    low: values.find(value => value >= q1 - 1.5 * iqr), high: [...values].reverse().find(value => value <= q3 + 1.5 * iqr) };
}
function node(tag, attributes = {}, text = null) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  if (text !== null) element.textContent = text;
  return element;
}
function append(svg, tag, attributes, text) { const element = node(tag, attributes, text); svg.append(element); return element; }
function dieKey(row) { return `${row.lot_id}/${row.wafer_id}/${row.die_id}`; }
let dataset, waferView, currentGroups = [], currentRows = [];
const GROUPS_PER_PLOT = 60;
let plotPage = 0, plottedGroups = [];

function applyHighlight() {
  const selected = state.hovered || state.selected;
  for (const point of document.querySelectorAll('.point')) {
    point.classList.toggle('dimmed', Boolean(selected) && point.dataset.die !== selected);
    point.classList.toggle('highlight', point.dataset.die === selected);
    point.setAttribute('r', point.dataset.die === selected ? 4.8 : 3);
  }
  for (const trace of document.querySelectorAll('.voltage-trace')) {
    trace.classList.toggle('dimmed', Boolean(selected) && trace.dataset.die !== selected);
    trace.setAttribute('stroke', trace.dataset.die === selected ? '#e28d27' : '#6b98cd');
    trace.setAttribute('stroke-width', trace.dataset.die === selected ? '2.5' : '0.8');
    trace.setAttribute('opacity', trace.dataset.die === selected ? '1' : '0.2');
  }
}
function hideTooltip() { get('tooltip').hidden = true; state.hovered = ''; applyHighlight(); }
function showTooltip(event, row, probability) {
  const tooltip = get('tooltip');
  tooltip.replaceChildren();
  const title = document.createElement('strong'); title.textContent = `${row.die_id} · ${row[state.group]}`; tooltip.append(title);
  const fields = [['RO', row.ro_id], ['Cell height', row.cell_height], ['Voltage', `${row.vdd_v} V`], ['Ratio', row.silicon_sim_ratio.toFixed(5)], ['Frequency', `${frequencyText(row.silicon_mean_frequency_mhz)}`], ['Simulation', `${frequencyText(row.simulation_frequency_mhz)}`], ['Repeat readings', row.repeat_count ?? '未提供'], ['Wafer location', `(${row.wafer_x}, ${row.wafer_y})`]];
  if (probability !== undefined) fields.push(['Cumulative probability', `${(probability * 100).toFixed(2)}%`]);
  for (const [label, value] of fields) { const line = document.createElement('div'); line.textContent = `${label}: ${value}`; tooltip.append(line); }
  tooltip.hidden = false;
  const target = event.currentTarget.getBoundingClientRect();
  const left = Number.isFinite(event.clientX) && event.clientX > 0 ? event.clientX : target.right;
  const top = Number.isFinite(event.clientY) && event.clientY > 0 ? event.clientY : target.top;
  tooltip.style.left = `${Math.max(8, Math.min(left + 15, window.innerWidth - tooltip.offsetWidth - 10))}px`;
  tooltip.style.top = `${Math.max(8, Math.min(top + 10, window.innerHeight - tooltip.offsetHeight - 10))}px`;
  state.hovered = dieKey(row); applyHighlight();
}
function selectDie(key) {
  state.selected = key; get('die-select').value = key;
  get('announcer').textContent = key ? `已选择 ${key.split('/').pop()}，两图高亮该 die。` : '已清除 die 选择';
  updateTable(); applyHighlight(); waferView?.highlight(key);
}
function point(svg, row, x, y, color, probability) {
  const circle = append(svg, 'circle', { cx: x, cy: y, r: 3, fill: color, opacity: 0.62, class: 'point', tabindex: '0', role: 'button', 'aria-label': `${row.die_id}, ${row[state.group]}, ${metricLabel(state.metric, METRICS[state.metric].label)}: ${metricNumber(row[METRICS[state.metric].field], state.metric, METRICS[state.metric].digits)}，按回车高亮` });
  circle.dataset.die = dieKey(row);
  circle.addEventListener('pointerenter', event => showTooltip(event, row, probability));
  circle.addEventListener('pointermove', event => showTooltip(event, row, probability));
  circle.addEventListener('pointerleave', hideTooltip);
  circle.addEventListener('focus', event => showTooltip(event, row, probability));
  circle.addEventListener('blur', hideTooltip);
  circle.addEventListener('click', () => selectDie(state.selected === dieKey(row) ? '' : dieKey(row)));
  circle.addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); selectDie(dieKey(row)); } });
}
function axis(svg, xMap, domain, plotHeight = 292, left = 95) {
  const bottom = 22 + plotHeight;
  for (let index = 0; index < 6; index++) {
    const value = domain[0] + (domain[1] - domain[0]) * index / 5, position = xMap(value);
    append(svg, 'line', { x1: position, x2: position, y1: 22, y2: bottom, class: 'grid-line' });
    append(svg, 'text', { x: position, y: bottom + 22, 'text-anchor': 'middle', class: 'tick-label' }, metricTick(value, state.metric, (domain[1] - domain[0]) / 5));
  }
  append(svg, 'line', { x1: left, x2: 580, y1: bottom, y2: bottom, class: 'axis-line' });
  append(svg, 'text', { x: (left + 580) / 2, y: bottom + 51, 'text-anchor': 'middle', class: 'axis-title' }, metricLabel(state.metric, METRICS[state.metric].label));
  const reference = METRICS[state.metric].ref;
  if (reference !== null) append(svg, 'line', { x1: xMap(reference), x2: xMap(reference), y1: 22, y2: bottom, class: 'reference-line' });
}
function renderCharts() {
  const metric = METRICS[state.metric];
  let minimum = metric.ref ?? Infinity, maximum = metric.ref ?? -Infinity;
  for (const row of currentRows) {
    minimum = Math.min(minimum, row[metric.field]);
    maximum = Math.max(maximum, row[metric.field]);
  }
  const padding = (maximum - minimum || Math.abs(minimum) * 0.1 || 0.1) * 0.07;
  const domain = [minimum - padding, maximum + padding];
  const start = plotPage * GROUPS_PER_PLOT;
  plottedGroups = currentGroups.slice(start, start + GROUPS_PER_PLOT);
  const left = Math.min(280, Math.max(95, Math.max(...plottedGroups.map(group => group.displayLabel.length)) * 6.5 + 18));
  const xMap = value => left + (value - domain[0]) / (domain[1] - domain[0]) * (580 - left);
  const box = get('box-chart'), probability = get('probability-chart');
  const boxHeight = Math.max(292, plottedGroups.length * 38);
  box.setAttribute('viewBox', `0 0 610 ${boxHeight + 78}`);
  box.replaceChildren(); probability.replaceChildren(); axis(box, xMap, domain, boxHeight, left); axis(probability, xMap, domain, 292, left);
  const minCount = Math.min(...plottedGroups.map(group => group.records.length));
  const maxCount = Math.max(...plottedGroups.map(group => group.records.length));
  const largestGroup = currentGroups.reduce((max, group) => Math.max(max, group.records.length), 0);
  const normalBound = Math.max(2.4, Math.abs(normalQuantile(0.5 / largestGroup)) + 0.08);
  const yMap = value => state.probability === 'normal' ? 314 - (normalQuantile(value) + normalBound) / (2 * normalBound) * 292 : 314 - value * 292;
  for (const cumulative of [0.01, 0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99]) {
    const y = yMap(cumulative);
    append(probability, 'line', { x1: left, x2: 580, y1: y, y2: y, class: cumulative === 0.5 ? 'reference-line' : 'grid-line' });
    append(probability, 'text', { x: left - 13, y: y + 4, 'text-anchor': 'end', class: 'tick-label' }, `${cumulative * 100}%`);
  }
  append(probability, 'text', { transform: 'translate(22 175) rotate(-90)', 'text-anchor': 'middle', class: 'axis-title' }, 'Cumulative probability');
  plottedGroups.forEach((group, index) => {
    const y = 22 + (index + 0.5) * boxHeight / plottedGroups.length, halfHeight = Math.min(15, boxHeight / plottedGroups.length * 0.24);
    append(box, 'text', { x: left - 13, y: y + 4, 'text-anchor': 'end', class: 'tick-label' }, group.displayLabel);
    append(box, 'line', { x1: xMap(group.low), x2: xMap(group.high), y1: y, y2: y, stroke: '#63758d', 'stroke-width': 1.4 });
    for (const whisker of [group.low, group.high]) append(box, 'line', { x1: xMap(whisker), x2: xMap(whisker), y1: y - 7, y2: y + 7, stroke: '#63758d', 'stroke-width': 1.4 });
    append(box, 'rect', { x: xMap(group.q1), y: y - halfHeight, width: Math.max(1, xMap(group.q3) - xMap(group.q1)), height: 2 * halfHeight, fill: group.color, 'fill-opacity': 0.22, stroke: group.color, 'stroke-opacity': 0.5 });
    append(box, 'line', { x1: xMap(group.median), x2: xMap(group.median), y1: y - halfHeight, y2: y + halfHeight, stroke: '#263c56', 'stroke-width': 2 });
    group.records.forEach((row, rank) => {
      const jitter = ((Number(row.die_id.replace(/\D/g, '')) * 47 + index * 13) % 101) / 100 - 0.5;
      point(box, row, xMap(row[metric.field]), y + jitter * halfHeight * 1.6, group.color);
      const cumulative = (rank + 0.5) / group.records.length;
      point(probability, row, xMap(row[metric.field]), yMap(cumulative), group.color, cumulative);
    });
  });
  get('p-title').textContent = state.probability === 'normal' ? 'Normal probability plot' : 'Cumulative probability plot';
  get('probability-badge').textContent = state.probability === 'normal' ? 'NORMAL SCALE' : 'LINEAR SCALE';
  get('plot-note').textContent = `两图横轴一致；${dataset.metadata.input_format === 'analysis_matrix' ? '每点为源 CSV 对应 metric 的值；原始重复次数未提供。' : '每点为一个 die / 完整配置的观测。'}须采用 1.5×IQR；概率位置 p=(rank−0.5)/n。${state.probability === 'normal' ? '纵轴为正态概率刻度。' : '纵轴为线性概率刻度。'}每组 n=${minCount === maxCount ? minCount : `${minCount}–${maxCount}`}；仅展示观测点。`;
  applyHighlight();
}
function renderPlotPage() {
  const pages = Math.ceil(currentGroups.length / GROUPS_PER_PLOT);
  get('plot-pages').hidden = pages <= 1;
  get('plot-prev').disabled = plotPage === 0;
  get('plot-next').disabled = plotPage + 1 >= pages;
  if (pages > 1) get('plot-page-label').textContent = `第 ${plotPage + 1} / ${pages} 页 · 共 ${currentGroups.length.toLocaleString()} 组`;
  get('export-svg').textContent = pages > 1 ? '导出本页 SVG' : '导出图形 SVG';
  get('legend').replaceChildren();
  plottedGroups = [];
  if (!currentRows.length) return;
  renderCharts();
  if (state.group === 'vdd_v' && get('voltage-sweep-card').hidden) {
    get('plot-note').textContent += ' 当前选择多个 cell，将其他维度选为单值可查看同 cell 的 voltage sweep。';
  }
  get('box-chart').parentElement.scrollTop = 0;
  for (const group of plottedGroups) {
    const item = document.createElement('span'), swatch = document.createElement('i');
    swatch.className = 'swatch'; swatch.style.background = group.color;
    item.append(swatch, `${group.displayLabel} (n=${group.records.length})`);
    get('legend').append(item);
  }
}
function updateTable() {
  const metric = METRICS[state.metric], body = get('stats-body'); body.replaceChildren();
  const digits = metric.digits;
  for (const group of currentGroups) {
    const row = document.createElement('tr'), heading = document.createElement('td');
    const swatch = document.createElement('span'); swatch.className = 'swatch'; swatch.style.background = group.color;
    heading.append(swatch, group.displayLabel); row.append(heading);
    const selected = group.records.find(record => dieKey(record) === state.selected);
    const cv = state.metric !== 'deviation' && group.mean > 0 && group.deviation !== null ? (100 * group.deviation / group.mean).toFixed(2) : '—';
    const format = value => metricNumber(value, state.metric, digits);
    for (const value of [group.records.length, format(group.median), format(group.p10), format(group.p90), group.deviation === null ? '—' : format(group.deviation), cv, selected ? format(selected[metric.field]) : '—']) {
      const cell = document.createElement('td'); cell.textContent = value; row.append(cell);
    }
    body.append(row);
  }
  get('selected-column').textContent = state.selected ? state.selected.split('/').pop() : 'SELECTED DIE';
  get('selection-detail').textContent = state.selected ? `已锁定 ${state.selected.split('/').pop()}；表格末列显示该 die 在各组的数值。` : '悬浮查看点位，点击锁定同一 die 的跨图高亮。';
}
function renderVoltageSweep() {
  const svg = get('voltage-sweep'); svg.replaceChildren();
  const config = METRICS[state.metric], voltages = currentGroups.map(group => Number(group.label));
  const observed = currentRows.map(row => row[config.field]);
  const baselineValues = state.metric === 'frequency' ? currentRows.map(row => row.simulation_frequency_mhz) : config.ref === null ? [] : [config.ref];
  const low = Math.min(...observed, ...baselineValues), high = Math.max(...observed, ...baselineValues);
  const padding = (high - low || Math.abs(low) * 0.1 || 0.1) * 0.1;
  const voltageLow = Math.min(...voltages), voltageHigh = Math.max(...voltages);
  const xMap = value => voltageHigh === voltageLow ? 600 : 115 + (value - voltageLow) / (voltageHigh - voltageLow) * 900;
  const yMap = value => 239 - (value - low + padding) / (high - low + 2 * padding) * 205;
  for (let index = 0; index < 5; index++) {
    const value = low - padding + (high - low + 2 * padding) * index / 4, y = yMap(value);
    append(svg, 'line', { x1: 100, x2: 1030, y1: y, y2: y, class: 'grid-line' });
    append(svg, 'text', { x: 86, y: y + 4, 'text-anchor': 'end', class: 'tick-label' }, metricTick(value, state.metric, (high - low + 2 * padding) / 4));
  }
  for (const voltage of voltages) append(svg, 'text', { x: xMap(voltage), y: 265, 'text-anchor': 'middle', class: 'tick-label' }, `${voltage} V`);
  append(svg, 'text', { x: 560, y: 293, 'text-anchor': 'middle', class: 'axis-title' }, 'Voltage (V)');
  append(svg, 'text', { transform: 'translate(26 138) rotate(-90)', 'text-anchor': 'middle', class: 'axis-title' }, metricLabel(state.metric, config.label));
  const traces = new Map();
  for (const row of currentRows) { const key = dieKey(row); if (!traces.has(key)) traces.set(key, []); traces.get(key).push(row); }
  for (const [key, records] of traces) {
    records.sort((first, second) => first.vdd_v - second.vdd_v);
    const path = records.map((row, index) => `${index ? 'L' : 'M'}${xMap(row.vdd_v)},${yMap(row[config.field])}`).join(' ');
    const trace = append(svg, 'path', { d: path, fill: 'none', stroke: '#6b98cd', opacity: 0.2, 'stroke-width': 0.8, class: 'voltage-trace' }); trace.dataset.die = key;
  }
  const medianPath = currentGroups.map((group, index) => `${index ? 'L' : 'M'}${xMap(Number(group.label))},${yMap(group.median)}`).join(' ');
  append(svg, 'path', { d: medianPath, fill: 'none', stroke: '#253b5b', 'stroke-width': 2.5, 'stroke-dasharray': '7 4' });
  if (state.metric === 'frequency') {
    const baselinePath = currentGroups.map((group, index) => {
      const baselines = group.records.map(row => row.simulation_frequency_mhz).sort((first, second) => first - second);
      return `${index ? 'L' : 'M'}${xMap(Number(group.label))},${yMap(quantile(baselines, 0.5))}`;
    }).join(' ');
    append(svg, 'path', { d: baselinePath, fill: 'none', stroke: '#8b8f98', 'stroke-width': 2, 'stroke-dasharray': '3 4' });
  } else if (config.ref !== null) append(svg, 'line', { x1: 100, x2: 1030, y1: yMap(config.ref), y2: yMap(config.ref), class: 'reference-line' });
  currentGroups.forEach(group => {
    for (const row of group.records) point(svg, row, xMap(row.vdd_v), yMap(row[config.field]), group.color);
    append(svg, 'circle', { cx: xMap(Number(group.label)), cy: yMap(group.median), r: 5, fill: '#253b5b', 'pointer-events': 'none' });
  });
  append(svg, 'text', { x: 100, y: 15, fill: '#697a90', 'font-size': 12 }, state.metric === 'frequency' ? 'Solid faint lines: individual die; dark dashed: measure median; gray dotted: simulation median' : state.metric === 'simulation' ? 'Solid faint lines: simulation values per die; dark dashed: simulation median' : 'Solid faint lines: individual die; dark dashed: median; horizontal reference: model match');
  applyHighlight();
}
function exportVoltageSweep() {
  const svg = get('voltage-sweep').cloneNode(true); svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svg.setAttribute('viewBox', '0 -65 1100 420'); svg.setAttribute('width', 1100); svg.setAttribute('height', 420);
  svg.prepend(node('rect', { x: 0, y: -65, width: 1100, height: 420, fill: 'white' }));
  append(svg, 'style', {}, 'text{font-family:Arial,sans-serif}.grid-line{stroke:#eaf0f6}.tick-label{font-size:12px;fill:#697a90}.axis-title{font-size:13px;fill:#5d6f86}.reference-line{stroke:#8d9aae;stroke-dasharray:5 4}.dimmed{opacity:.11}.highlight{stroke:#152d4e;stroke-width:1.7}');
  append(svg, 'text', { x: 100, y: -38, fill: '#23334b', 'font-size': 18 }, `${get('voltage-ro').value} | ${metricLabel(state.metric, METRICS[state.metric].label)} | ${dataset.metadata.origin}`);
  append(svg, 'text', { x: 100, y: -13, fill: '#697a90', 'font-size': 12 }, `${dataset.metadata.temperature_c} C | ${dataset.metadata.corner} | ${dataset.metadata.simulation_version} | ${get('voltage-paired').checked ? 'Common die across selected voltages' : 'Available die at each selected voltage'}`);
  append(svg, 'text', { x: 100, y: 330, fill: '#697a90', 'font-size': 12 }, 'Connected measured voltage points only; no fitted model or extrapolation.');
  download('ro_voltage_sweep.svg', new XMLSerializer().serializeToString(svg), 'image/svg+xml');
}
function synchronizeControls() {
  for (const dimension of Object.keys(ORDERS)) {
    const select = get(dimension);
    const values = [...(selectedGroups[dimension] || [])];
    select.textContent = `${values.length && values.length <= 2 ? values.join(', ') : `已选 ${values.length} / ${ORDERS[dimension].length}`} ▾`;
    select.setAttribute('aria-label', `${DIMENSION_NAMES[dimension]} · ${select.textContent}`);
    for (const checkbox of get(`${dimension}-options`).querySelectorAll('input')) {
      checkbox.checked = selectedGroups[dimension].has(checkbox.value);
    }
  }
  get('group').value = state.group; get('metric').value = state.metric; get('probability').value = state.probability;
}
function renderGroupPicker() {
  for (const dimension of Object.keys(ORDERS)) renderDimensionOptions(dimension);
}
function renderDimensionOptions(dimension) {
  const options = get(`${dimension}-options`), scroll = options.scrollTop;
  const chosen = selectedGroups[dimension], query = groupSearches[dimension] || '';
  const visible = ORDERS[dimension].filter(value => value.toLowerCase().includes(query.toLowerCase().trim()));
  options.replaceChildren();
  const legend = document.createElement('legend'); legend.className = 'sr-only'; legend.textContent = `选择 ${DIMENSION_NAMES[dimension]}`; options.append(legend);
  for (const value of visible) {
    const label = document.createElement('label'), checkbox = document.createElement('input'), text = document.createElement('span'), swatch = document.createElement('i');
    checkbox.type = 'checkbox'; checkbox.value = value; checkbox.checked = chosen.has(value); checkbox.setAttribute('aria-label', dimension === 'vdd_v' ? `${value} V` : value);
    swatch.className = 'swatch'; swatch.style.background = groupColor(ORDERS[dimension].indexOf(value));
    text.textContent = dimension === 'vdd_v' ? `${value} V` : value;
    label.append(checkbox, swatch, text); options.append(label);
    checkbox.addEventListener('change', () => {
      const selection = selectedGroups[dimension];
      if (checkbox.checked) selection.add(value); else selection.delete(value);
      synchronizeControls(); render();
    });
  }
  options.scrollTop = scroll;
  get(`${dimension}-empty`).hidden = visible.length > 0;
  get(`${dimension}-visible`).disabled = !visible.length;
}
function mountDimensionDropdowns() {
  for (const dimension of Object.keys(ORDERS)) {
    const old = get(dimension), wrapper = document.createElement('div'); wrapper.className = 'dimension-dropdown';
    const caption = document.createElement('span'); caption.textContent = DIMENSION_NAMES[dimension].toUpperCase(); wrapper.append(caption);
    const button = document.createElement('button'); button.id = dimension; button.type = 'button'; button.setAttribute('aria-expanded', 'false'); button.setAttribute('aria-controls', `${dimension}-menu`); wrapper.append(button);
    const menu = document.createElement('div'); menu.className = 'dimension-menu'; menu.id = `${dimension}-menu`; menu.hidden = true;
    menu.innerHTML = `<input type="search" id="${dimension}-search" aria-label="搜索 ${DIMENSION_NAMES[dimension]}" placeholder="搜索…"><div class="dimension-actions"><button type="button" data-action="all">全选</button><button type="button" data-action="none">清空</button><button type="button" data-action="visible" id="${dimension}-visible">勾选搜索结果</button></div><fieldset id="${dimension}-options"></fieldset><p id="${dimension}-empty" hidden>没有匹配项</p>`;
    wrapper.append(menu); old.closest('label').replaceWith(wrapper);
    button.addEventListener('click', () => {
      const opening = menu.hidden;
      closeDimensionMenus(); menu.hidden = !opening; button.setAttribute('aria-expanded', String(opening));
      menu.style.setProperty('--dropdown-top', `${Math.max(8, Math.min(button.getBoundingClientRect().bottom + 6, window.innerHeight - 200))}px`);
      if (opening) get(`${dimension}-search`).focus();
    });
    get(`${dimension}-search`).addEventListener('input', event => { groupSearches[dimension] = event.target.value; renderDimensionOptions(dimension); });
    for (const action of menu.querySelectorAll('[data-action]')) action.addEventListener('click', () => {
      if (action.dataset.action === 'none') selectedGroups[dimension].clear();
      else for (const value of ORDERS[dimension]) if (action.dataset.action === 'all' || value.toLowerCase().includes((groupSearches[dimension] || '').toLowerCase().trim())) selectedGroups[dimension].add(value);
      synchronizeControls(); render();
    });
  }
  document.addEventListener('click', event => { if (!event.target.closest('.dimension-dropdown')) closeDimensionMenus(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { const active = document.querySelector('.dimension-dropdown button[aria-expanded="true"]'); closeDimensionMenus(); active?.focus(); } });
}
function closeDimensionMenus() {
  for (const menu of document.querySelectorAll('.dimension-menu')) menu.hidden = true;
  for (const button of document.querySelectorAll('.dimension-dropdown > button')) button.setAttribute('aria-expanded', 'false');
}
function groupColor(index) { return index < PALETTE.length ? PALETTE[index] : `hsl(${(index * 137.508) % 360} 58% 43%)`; }
function changeGrouping(dimension) {
  state.group = dimension;
  synchronizeControls(); render();
}
function render() {
  hideTooltip();
  const chosen = selectedGroups[state.group];
  currentRows = dataset.records.filter(row => Object.keys(ORDERS).every(dimension => selectedGroups[dimension].has(String(row[dimension]))));
  const voltageMode = state.group === 'vdd_v';
  get('voltage-controls').hidden = !voltageMode;
  if (voltageMode) {
    const select = get('voltage-ro');
    const roIds = [...new Set(currentRows.map(row => row.ro_id))];
    select.replaceChildren(new Option(roIds.length === 1 ? roIds[0] : `${roIds.length} cells，分别成组`, roIds.length === 1 ? roIds[0] : '*')); select.disabled = true;
    const rawCount = currentRows.length;
    if (get('voltage-paired').checked) {
      const perDie = new Map();
      for (const row of currentRows) { const key = JSON.stringify([row.ro_id, dieKey(row)]); if (!perDie.has(key)) perDie.set(key, new Set()); perDie.get(key).add(String(row.vdd_v)); }
      const complete = new Set([...perDie].filter(([, voltages]) => [...chosen].every(voltage => voltages.has(voltage))).map(([key]) => key));
      currentRows = currentRows.filter(row => complete.has(JSON.stringify([row.ro_id, dieKey(row)])));
    }
    get('voltage-coverage').textContent = `${new Set(currentRows.map(dieKey)).size} die · ${rawCount - currentRows.length} 条非完整配对观测排除`;
  }
  const buckets = new Map();
  const dimensions = [state.group, ...Object.keys(ORDERS).filter(key => key !== state.group)];
  const varying = dimensions.filter(key => selectedGroups[key].size > 1);
  for (const row of currentRows) {
    const key = JSON.stringify([...dimensions.map(dimension => String(row[dimension])), row.ro_id]);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(row);
  }
  currentGroups = [...buckets].map(([key, records]) => {
    const row = records[0], label = String(row[state.group]);
    const identities = records.map(dieKey);
    if (new Set(identities).size !== identities.length) throw new Error('同一完整 cell/voltage 配置中存在重复 die');
    const descriptions = [state.group, ...varying.filter(dimension => dimension !== state.group)].map(dimension => dimension === 'vdd_v' ? `${row[dimension]} V` : row[dimension]);
    let hash = 0; for (const character of JSON.stringify(dimensions.slice().sort().map(dimension => [dimension, row[dimension]]))) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
    const color = `hsl(${(hash * 137.508) % 360} 58% 42%)`;
    return { key, label, displayLabel: descriptions.join(' / '), color, ...summarize(records) };
  }).sort((first, second) => {
    for (const dimension of dimensions) { const difference = ORDERS[dimension].indexOf(String(first.records[0][dimension])) - ORDERS[dimension].indexOf(String(second.records[0][dimension])); if (difference) return difference; }
    return first.records[0].ro_id.localeCompare(second.records[0].ro_id);
  });
  const duplicateLabels = new Map(); for (const group of currentGroups) duplicateLabels.set(group.displayLabel, (duplicateLabels.get(group.displayLabel) || 0) + 1);
  for (const group of currentGroups) if (duplicateLabels.get(group.displayLabel) > 1) group.displayLabel += ` / ${group.records[0].ro_id}`;
  get('distribution-empty').hidden = currentRows.length > 0;
  get('distribution-empty').textContent = Object.values(selectedGroups).some(values => !values.size) ? '请在各维度的下拉框中至少勾选一项。' : '所选组合没有数据，或没有覆盖所选电压的配对 die。可调整筛选或关闭完整配对。';
  get('export-csv').disabled = !currentRows.length; get('export-svg').disabled = !currentRows.length;
  document.querySelector('.charts').hidden = !currentRows.length;
  const singleCellSweep = voltageMode && new Set(currentRows.map(row => row.ro_id)).size === 1;
  get('voltage-sweep-card').hidden = !singleCellSweep || !currentRows.length;
  const dies = [...new Set(currentRows.map(dieKey))].sort();
  if (state.selected && !dies.includes(state.selected)) state.selected = '';
  const select = get('die-select'); select.replaceChildren(new Option('未选择', ''));
  for (const key of dies) select.add(new Option(key.split('/').pop(), key)); select.value = state.selected;
  get('die-count').textContent = dies.length;
  get('die-count').nextElementSibling.textContent = voltageMode ? (get('voltage-paired').checked ? '所选电压共有的配对 die' : '所选电压可用 die 的并集') : '同一批 die，跨组配对';
  get('group-count').textContent = currentGroups.length;
  get('observation-count').textContent = currentRows.length.toLocaleString();
  get('observation-count').nextElementSibling.textContent = '每点对应一个 die / 完整配置';
  get('voltage-sweep-card').querySelector('.chart-title p').textContent = '浅线连接同一 die 在当前 metric 下的观测点；深线为中位数，无拟合或外推。';
  const medians = currentGroups.map(group => quantile(group.records.map(row => row.silicon_sim_ratio).sort((first, second) => first - second), 0.5));
  get('median-range').textContent = medians.length ? `${Math.min(...medians).toFixed(3)}–${Math.max(...medians).toFixed(3)}` : '—';
  const groupLabel = DIMENSION_NAMES[state.group];
  get('group-description').textContent = `按 ${groupLabel} 分组`;
  get('comparison-title').textContent = `${groupLabel} comparison`;
  get('fixed-description').textContent = Object.keys(ORDERS).filter(key => key !== state.group).map(key => `${DIMENSION_NAMES[key]}: ${[...selectedGroups[key]].join(', ') || '未选'}`).join(' · ');
  document.querySelector('.environment').textContent = `${[...selectedGroups.vdd_v].join(' / ') || '未选电压'} V · ${typeof dataset.metadata.temperature_c === 'number' ? `${dataset.metadata.temperature_c}°C` : '温度未提供'} · ${dataset.metadata.corner === '未提供' ? 'Corner 未提供' : dataset.metadata.corner}`;
  get('condition-label').textContent = `${metricLabel(state.metric, METRICS[state.metric].label)} · per-die statistics`;
  plotPage = 0;
  renderPlotPage();
  if (singleCellSweep) renderVoltageSweep();
  if (!currentRows.length) {
    get('box-chart').replaceChildren();
    get('probability-chart').replaceChildren();
    get('plot-note').textContent = '没有可绘制观测。';
  }
  updateTable();
}
function download(filename, content, mime) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  get('announcer').textContent = `已导出 ${filename}`;
}
function exportCSV() {
  const fields = ['group', 'lot_id', 'wafer_id', 'die_id', 'ro_id', 'metric', 'value', 'rank', 'cumulative_probability', 'repeat_count', 'silicon_frequency_mhz', 'simulation_frequency_mhz', 'ratio', 'vdd_v', 'temperature_c', 'corner', 'simulation_version', 'layout_version', 'data_origin', 'cell_height', 'function', 'vt', 'drive'];
  const rows = [fields];
  for (const group of currentGroups) group.records.forEach((row, rank) => rows.push([group.displayLabel, row.lot_id, row.wafer_id, row.die_id, row.ro_id, state.metric, row[METRICS[state.metric].field], rank + 1, (rank + 0.5) / group.records.length, row.repeat_count, row.silicon_mean_frequency_mhz, row.simulation_frequency_mhz, row.silicon_sim_ratio, row.vdd_v, dataset.metadata.temperature_c, dataset.metadata.corner, dataset.metadata.simulation_version, dataset.metadata.layout_version, dataset.metadata.origin, row.cell_height, row.function, row.vt, row.drive]));
  fields.push('value_unit');
  for (const row of rows.slice(1)) row.push(['frequency', 'simulation'].includes(state.metric) ? 'MHz' : state.metric === 'ratio' ? 'Measure/Simulation' : '%');
  const escaped = rows.map(row => row.map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n');
  download(`ro_${state.group}_${state.metric}.csv`, `\uFEFF${escaped}`, 'text/csv;charset=utf-8');
}
function exportSVG() {
  const chartHeight = Math.max(370, get('box-chart').viewBox.baseVal.height);
  const legendHeight = Math.ceil(plottedGroups.length / 6) * 20;
  const totalHeight = chartHeight + 160 + legendHeight;
  const combined = node('svg', { xmlns: 'http://www.w3.org/2000/svg', width: 1260, height: totalHeight, viewBox: `0 0 1260 ${totalHeight}` });
  append(combined, 'rect', { width: 1260, height: totalHeight, fill: 'white' });
  append(combined, 'metadata', {}, JSON.stringify({ groupBy: state.group, filterSelections: Object.fromEntries(Object.keys(ORDERS).map(key => [key, [...selectedGroups[key]]])), commonDieOnly: state.group === 'vdd_v' ? get('voltage-paired').checked : null }));
  append(combined, 'style', {}, 'text{font-family:Arial,sans-serif}.grid-line{stroke:#eaf0f6}.axis-line{stroke:#c8d2df}.tick-label{font-size:12px;fill:#697a90}.axis-title{font-size:13px;fill:#5d6f86}.reference-line{stroke:#8d9aae;stroke-dasharray:5 4}.dimmed{opacity:.11}.highlight{opacity:1;stroke:#152d4e;stroke-width:1.7}');
  append(combined, 'text', { x: 30, y: 30, fill: '#23334b', 'font-size': 20 }, `${get('comparison-title').textContent} | ${get('fixed-description').textContent} | ${dataset.metadata.origin}`);
  append(combined, 'text', { x: 30, y: 53, fill: '#697a90', 'font-size': 13 }, `${[...selectedGroups.vdd_v].join(', ')} V / ${dataset.metadata.temperature_c} C | ${dataset.metadata.corner} | ${dataset.metadata.simulation_version} | ${metricLabel(state.metric, METRICS[state.metric].label)}`);
  for (const [index, id] of ['box-chart', 'probability-chart'].entries()) {
    append(combined, 'text', { x: index * 620 + 35, y: 82, fill: '#23334b', 'font-size': 16 }, index === 0 ? 'Box plot' : get('p-title').textContent);
    const chart = get(id).cloneNode(true); chart.setAttribute('x', index * 620 + 10); chart.setAttribute('y', 95); chart.setAttribute('width', 610); chart.setAttribute('height', index === 0 ? chartHeight : 370); combined.append(chart);
  }
  plottedGroups.forEach((group, index) => append(combined, 'text', { x: 30 + index % 6 * 200, y: chartHeight + 120 + Math.floor(index / 6) * 20, fill: group.color, 'font-size': 12 }, `${group.displayLabel}: n=${group.records.length}`));
  append(combined, 'text', { x: 30, y: chartHeight + 140 + legendHeight, fill: '#697a90', 'font-size': 12 }, `Point = one die / full configuration at the selected metric; p=(rank-0.5)/n; whiskers=1.5 IQR; no tail extrapolation. ${state.selected ? `Selected: ${state.selected}` : ''}`);
  const pageSuffix = currentGroups.length > GROUPS_PER_PLOT ? `_page_${plotPage + 1}` : '';
  download(`ro_${state.group}_${state.metric}_${state.probability}${pageSuffix}.svg`, new XMLSerializer().serializeToString(combined), 'image/svg+xml');
}
function qualityDialog() {
  const report = dataset.validation, content = get('quality-content'); content.replaceChildren();
  const introduction = document.createElement('p'); introduction.textContent = dataset.metadata.input_format === 'analysis_matrix' ? `唯一输入：${dataset.metadata.source_file}。直接读取 Parameter × PID 矩阵，按参数匹配 Simulation / Measure / Ratio，不补造重复读数或测试条件。` : `数据来源：${dataset.metadata.origin}。导入过程保留原始记录，按精确测试条件匹配 simulation；重复读数先在 die/RO 内合并。`; content.append(introduction);
  const list = document.createElement('dl');
  for (const [label, value] of [['输入观测数', report.matched_measurements + report.excluded_measurements], ['匹配观测数', report.matched_measurements], ['排除数', report.excluded_measurements], ['质量问题数', report.issue_count], ['独立 die 数', report.unique_matched_dies], ['RO 类型数', new Set(dataset.records.map(row => row.ro_id)).size], ['RO / voltage 基准组', report.ro_type_groups]]) {
    const term = document.createElement('dt'), definition = document.createElement('dd'); term.textContent = label; definition.textContent = value.toLocaleString(); list.append(term, definition);
  }
  content.append(list);
  const note = document.createElement('p'); note.textContent = `Source: ${dataset.metadata.dataset} · ${dataset.metadata.layout_version}。当前页面展示已校验的数据；CSV 上传将在数据管理阶段接入。`; content.append(note);
  get('quality-dialog').showModal();
}
async function initialize() {
  try {
    const response = await fetch('./data.json'); if (!response.ok) throw new Error(`HTTP ${response.status}`);
    dataset = await response.json();
    if (!dataset.records.length) throw new Error('数据为空');
    get('metric').querySelector('option[value="frequency"]').textContent = 'Measure';
    get('metric').add(new Option('Simulation', 'simulation'));
    const heightLabel = document.createElement('label'); heightLabel.innerHTML = 'CELL HEIGHT<select id="cell_height"></select>';
    get('vdd_v').closest('label').before(heightLabel);
    get('group').add(new Option('Cell height', 'cell_height'));
    for (const row of dataset.records) row.cell_height ??= '未提供';
    ORDERS.cell_height = [...new Set(dataset.records.map(row => row.cell_height))].sort();
    for (const dimension of ['function', 'vt', 'drive', 'cell_height']) {
      const observed = [...new Set(dataset.records.map(row => row[dimension]))];
      ORDERS[dimension] = [...ORDERS[dimension].filter(value => observed.includes(value)), ...observed.filter(value => !ORDERS[dimension].includes(value))];
      if (!ORDERS[dimension].includes(DEFAULTS[dimension])) DEFAULTS[dimension] = ORDERS[dimension][0];
      state[dimension] = DEFAULTS[dimension];
    }
    if (dataset.metadata.input_format === 'analysis_matrix') {
      get('observation-count').nextElementSibling.textContent = '每个点为源 CSV 的 Measure 值';
      document.querySelector('.charts .chart-title p').textContent = '中位数 · 中间 50% · 全部 die 观测值';
    }
    document.querySelector('.sidebar-note .tag').textContent = `${dataset.metadata.origin} DATA`;
    for (const row of dataset.records) row.vdd_v ??= dataset.metadata.vdd_v;
    ORDERS.vdd_v = [...new Set(dataset.records.map(row => row.vdd_v))].sort((first, second) => first - second).map(String);
    DEFAULTS.vdd_v = ORDERS.vdd_v.includes('0.8') ? '0.8' : ORDERS.vdd_v[0]; state.vdd_v = DEFAULTS.vdd_v;
    for (const dimension of Object.keys(ORDERS)) selectedGroups[dimension] = new Set(dimension === state.group ? ORDERS[dimension] : [DEFAULTS[dimension]]);
    mountDimensionDropdowns();
    renderGroupPicker();
    mountFrequencyUnit(document.querySelector('.filters'), 'frequency-unit');
    window.addEventListener('frequency-unit-change', render);
    const boxScroll = document.createElement('div'); boxScroll.className = 'box-scroll'; get('box-chart').before(boxScroll); boxScroll.append(get('box-chart'));
    document.querySelector('.sidebar-note p').innerHTML = `${dataset.validation.unique_matched_dies} die · ${new Set(dataset.records.map(row => row.ro_id)).size} RO types<br>${ORDERS.vdd_v.length} voltage points`;
    get('source-label').textContent = `${dataset.metadata.dataset} · 频率按 CSV Unit 换算；1 MHz = 1,000,000 Hz · CSV 导出频率保留 MHz`;
    document.querySelector('.count').textContent = dataset.validation.issue_count;
    synchronizeControls(); render();
    get('group').addEventListener('change', event => changeGrouping(event.target.value));
    get('plot-prev').addEventListener('click', () => { plotPage--; renderPlotPage(); });
    get('plot-next').addEventListener('click', () => { plotPage++; renderPlotPage(); });
    for (const dimension of ['metric', 'probability']) get(dimension).addEventListener('change', event => { state[dimension] = event.target.value; synchronizeControls(); render(); });
    for (const id of ['voltage-ro', 'voltage-paired']) get(id).addEventListener('change', render);
    get('voltage-sweep-export').addEventListener('click', exportVoltageSweep);
    get('reset').addEventListener('click', () => {
      closeDimensionMenus();
      Object.assign(state, DEFAULTS, { selected: '', hovered: '' });
      for (const dimension of Object.keys(ORDERS)) {
        selectedGroups[dimension] = new Set(dimension === state.group ? ORDERS[dimension] : [DEFAULTS[dimension]]);
        groupSearches[dimension] = '';
        get(`${dimension}-search`).value = '';
      }
      renderGroupPicker();
      synchronizeControls();
      render();
    });
    get('die-select').addEventListener('change', event => selectDie(event.target.value));
    get('clear-selection').addEventListener('click', () => { hideTooltip(); selectDie(''); });
    get('export-csv').addEventListener('click', exportCSV);
    get('export-svg').addEventListener('click', exportSVG);
    get('quality-open').addEventListener('click', qualityDialog);
    get('quality-close').addEventListener('click', () => get('quality-dialog').close());
    const showView = view => {
      hideTooltip(); get('quality-dialog').close();
      get('distribution-content').hidden = view !== 'distribution';
      get('wafer-content').hidden = view !== 'wafer';
      get('distribution-nav').classList.toggle('active', view === 'distribution');
      get('wafer-nav').classList.toggle('active', view === 'wafer');
      history.replaceState(null, '', view === 'wafer' ? '#wafer' : state.group === 'vdd_v' ? '#voltage' : '#distribution');
      if (view === 'wafer') waferView.render();
      else render();
      window.scrollTo({ top: 0, behavior: 'instant' });
    };
    waferView = createWaferView(dataset, selectDie, () => state.selected, filters => {
      Object.assign(state, filters);
      for (const dimension of Object.keys(ORDERS)) {
        if (filters[dimension] !== undefined) selectedGroups[dimension] = new Set([String(filters[dimension])]);
      }
      synchronizeControls();
      showView('distribution');
    });
    for (const id of ['distribution-nav', 'mobile-distribution']) get(id).addEventListener('click', () => showView('distribution'));
    for (const id of ['wafer-nav', 'mobile-wafer']) get(id).addEventListener('click', () => showView('wafer'));
    window.addEventListener('hashchange', () => {
      if (location.hash === '#voltage') changeGrouping('vdd_v');
      showView(location.hash === '#wafer' ? 'wafer' : 'distribution');
    });
    if (location.hash === '#wafer') showView('wafer');
    else if (location.hash === '#voltage') { changeGrouping('vdd_v'); showView('distribution'); }
    else get('distribution-content').hidden = false;
    window.addEventListener('scroll', hideTooltip, { passive: true });
  } catch (error) { get('loading-error').hidden = false; get('loading-error').textContent = `数据加载失败：${error.message}。请通过本地 HTTP 服务打开页面。`; }
}
initialize();
