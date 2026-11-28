import { frequencyText, metricLabel, metricNumber, mountFrequencyUnit, displayFrequency, storedFrequency, isFrequency } from './frequency.js';
const get = id => document.getElementById(id);
const keyOf = row => `${row.lot_id}/${row.wafer_id}/${row.die_id}`;
const waferOf = row => JSON.stringify([row.lot_id, row.wafer_id]);
const METRICS = {
  simulation: { field: 'simulation_frequency_mhz', label: 'Simulation frequency (MHz)', digits: 2 },
  ratio: { field: 'silicon_sim_ratio', label: 'Silicon / Simulation ratio', digits: 4 },
  frequency: { field: 'silicon_mean_frequency_mhz', label: 'Silicon frequency (MHz)', digits: 2 },
  deviation: { field: 'frequency_deviation_pct', label: 'Frequency deviation (%)', digits: 2 },
};
function element(tag, attributes = {}, text) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
}
const LIGHT_BLUE = [222, 238, 250];
const BLUE = [26, 83, 164];
const NEUTRAL = [245, 245, 245];
const RED = [179, 30, 45];
const rgb = channels => `rgb(${channels.join(',')})`;

function colorScale(minimum, maximum, ratioMode) {
  const center = (1 - minimum) / (maximum - minimum);
  const stops = ratioMode
    ? [[0, BLUE], [center, NEUTRAL], [1, RED]]
    : [[0, LIGHT_BLUE], [1, BLUE]];
  return {
    stops,
    tone(value) {
      const position = Math.max(0, Math.min(1, (value - minimum) / (maximum - minimum)));
      const segment = ratioMode && value > 1 ? 1 : 0;
      const start = stops[segment], end = stops[segment + 1];
      const fraction = (position - start[0]) / (end[0] - start[0]);
      const channels = start[1].map((component, index) => Math.round(component + fraction * (end[1][index] - component)));
      const darkness = ratioMode && segment === 0 ? 1 - fraction : fraction;
      return { fill: rgb(channels), text: darkness > 0.56 ? '#ffffff' : '#27486a' };
    },
  };
}
function save(name, content, mime) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const anchor = document.createElement('a'); anchor.download = name; anchor.href = url; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function createWaferView(dataset, onSelect, readSelection, openDistribution) {
  const container = get('wafer-content');
  container.innerHTML = `
    <div class="intro"><div><div class="eyebrow">SPATIAL ANALYSIS</div><h1>Wafer view</h1><p>按 cell 查看 die 的空间梯度，颜色表示实际观测值。</p></div><div class="actions"><button id="wafer-svg">导出 SVG</button><button class="primary" id="wafer-csv">导出 wafer CSV</button></div></div>
    <div class="filters wafer-filters"><label>WAFER<select id="wafer-id"></select></label><label>FUNCTION<select id="wafer-function"></select></label><label>VT<select id="wafer-vt"></select></label><label>DRIVE<select id="wafer-drive"></select></label><label>VOLTAGE<select id="wafer-voltage"></select></label><label>RO ID<select id="wafer-ro"></select></label><label>METRIC<select id="wafer-metric"><option value="ratio">Ratio</option><option value="frequency">Frequency · MHz</option><option value="deviation">Deviation · %</option></select></label></div>
    <div class="wafer-grid"><article class="chart-card wafer-map-card"><div class="chart-title"><div><h3 id="wafer-title">Die map</h3><p id="wafer-subtitle"></p></div><span class="badge">OBSERVED DIE</span></div><svg id="wafer-map" viewBox="0 0 720 620" role="img" aria-label="按坐标排列的 wafer die 数值图"></svg><div class="wafer-scale"><span id="wafer-scale-low"></span><div class="wafer-colorbar"></div><span id="wafer-scale-high"></span></div><p class="wafer-map-note">X 向右增加，Y 向上增加；未测位置留空，无插值。坐标范围不代表实际 wafer 边缘。</p></article>
    <aside class="wafer-details"><section class="wafer-detail-card"><h3>Color scale</h3><label class="wafer-lock"><input id="wafer-lock" type="checkbox"> 锁定当前色阶，跨 cell 对比</label><div class="wafer-limits"><label>MIN<input id="wafer-min" type="number" step="any" disabled></label><label>MAX<input id="wafer-max" type="number" step="any" disabled></label></div><p id="wafer-scale-status">自动范围按当前 cell 计算</p><p id="wafer-range-error" role="alert" hidden></p></section>
    <section class="wafer-detail-card"><h3>Cell statistics</h3><dl id="wafer-statistics"></dl></section>
    <section class="wafer-detail-card"><h3>Selected die</h3><label class="wafer-die-label">DIE<select id="wafer-die"></select></label><dl id="wafer-selected"></dl><div class="wafer-detail-actions"><button id="wafer-clear">清除</button><button id="wafer-distribution">查看分布图</button></div></section></aside></div>
    <p class="wafer-footnote" id="wafer-condition"></p><p class="wafer-footnote">空间模式需结合供电、温度、位置和工艺证据验证。</p>`;
  let rows = [], minimum = 0, maximum = 1, lastMetric = 'ratio', selected = readSelection();
  get('wafer-metric').querySelector('option[value="frequency"]').textContent = 'Measure';
  get('wafer-metric').add(new Option('Simulation', 'simulation'));
  const heightLabel = document.createElement('label'); heightLabel.innerHTML = 'CELL HEIGHT<select id="wafer-height"></select>';
  container.querySelector('.wafer-filters').append(heightLabel);
  const metric = () => ({ ...METRICS[get('wafer-metric').value], label: metricLabel(get('wafer-metric').value, METRICS[get('wafer-metric').value].label) });
  const format = value => metricNumber(value, get('wafer-metric').value, metric().digits);
  const ratioMode = () => get('wafer-metric').value === 'ratio';
  const colorbar = container.querySelector('.wafer-colorbar');
  const midpoint = document.createElement('span');
  midpoint.className = 'wafer-scale-midpoint';
  midpoint.textContent = '1.0';
  colorbar.append(midpoint);
  mountFrequencyUnit(container.querySelector('.wafer-filters'), 'wafer-frequency-unit');
  window.addEventListener('frequency-unit-change', () => {
    // Keep the physical locked range while its input values change units.
    if (get('wafer-lock').checked && isFrequency(get('wafer-metric').value)) {
      get('wafer-min').value = displayFrequency(minimum);
      get('wafer-max').value = displayFrequency(maximum);
    }
    render();
  });
  const addOptions = (id, values, preferred) => {
    const select = get(id); select.replaceChildren();
    for (const value of values) select.add(new Option(value, value));
    select.value = values.includes(preferred) ? preferred : values[0] || '';
  };
  const waferKeys = [...new Set(dataset.records.map(waferOf))];
  for (const key of waferKeys) get('wafer-id').add(new Option(JSON.parse(key).join(' / '), key));
  for (const [dimension, initial] of [['function', 'INV'], ['vt', 'SVT'], ['drive', 'X1']]) {
    addOptions(`wafer-${dimension}`, [...new Set(dataset.records.map(row => row[dimension]))], initial);
  }
  const voltages = [...new Set(dataset.records.map(row => String(row.vdd_v)))].sort((first, second) => Number(first) - Number(second));
  addOptions('wafer-voltage', voltages, String(dataset.metadata.vdd_v));
  addOptions('wafer-height', [...new Set(dataset.records.map(row => row.cell_height || '未提供'))].sort());
  function subset() {
    return dataset.records.filter(row => waferOf(row) === get('wafer-id').value && String(row.vdd_v) === get('wafer-voltage').value && (row.cell_height || '未提供') === get('wafer-height').value && ['function', 'vt', 'drive'].every(dimension => row[dimension] === get(`wafer-${dimension}`).value));
  }
  function updateRO() {
    addOptions('wafer-ro', [...new Set(subset().map(row => row.ro_id))], get('wafer-ro').value);
    render();
  }
  function setList(id, entries) {
    const list = get(id); list.replaceChildren();
    for (const [label, value] of entries) {
      const term = document.createElement('dt'), description = document.createElement('dd');
      term.textContent = label; description.textContent = value ?? '未提供'; list.append(term, description);
    }
  }
  function highlight(key) {
    selected = key;
    for (const die of container.querySelectorAll('.wafer-die')) {
      die.classList.toggle('wafer-selected', die.dataset.die === selected);
      die.setAttribute('stroke', die.dataset.die === selected ? '#e28d27' : '#ffffff');
      die.setAttribute('stroke-width', die.dataset.die === selected ? '4' : '1.5');
    }
    get('wafer-die').value = rows.some(row => keyOf(row) === selected) ? selected : '';
    const row = rows.find(record => keyOf(record) === selected);
    setList('wafer-selected', row ? [['Die', row.die_id], ['Voltage', `${row.vdd_v} V`], ['X / Y', `${row.wafer_x} / ${row.wafer_y}`], ['Ratio', row.silicon_sim_ratio.toFixed(5)], ['Frequency', `${frequencyText(row.silicon_mean_frequency_mhz)}`], ['Simulation', `${frequencyText(row.simulation_frequency_mhz)}`], ['Repeated readings', row.repeat_count]] : [['Selection', selected ? '所选 die 不在当前 wafer/cell' : '点击 die 查看数值']]);
  }
  function select(key) { onSelect(key); highlight(key); }
  function tooltip(event, row) {
    const tip = get('tooltip'); tip.replaceChildren();
    for (const line of [row.die_id, row.ro_id, `Voltage: ${row.vdd_v} V`, `X / Y: ${row.wafer_x} / ${row.wafer_y}`, `Ratio: ${row.silicon_sim_ratio.toFixed(5)}`, `Frequency: ${frequencyText(row.silicon_mean_frequency_mhz)}`, `Simulation: ${frequencyText(row.simulation_frequency_mhz)}`, `Repeated readings: ${row.repeat_count}`]) {
      const item = document.createElement('div'); item.textContent = line; tip.append(item);
    }
    tip.hidden = false;
    const box = event.currentTarget.getBoundingClientRect();
    const x = event.clientX || box.right, y = event.clientY || box.top;
    tip.style.left = `${Math.max(8, Math.min(x + 12, window.innerWidth - tip.offsetWidth - 10))}px`;
    tip.style.top = `${Math.max(8, Math.min(y + 12, window.innerHeight - tip.offsetHeight - 10))}px`;
  }
  function render() {
    const svg = get('wafer-map'); svg.replaceChildren(); get('tooltip').hidden = true;
    get('wafer-csv').disabled = true; get('wafer-svg').disabled = true;
    colorbar.parentElement.hidden = true;
    const config = metric();
    document.querySelector('.environment').textContent = `${get('wafer-voltage').value} V · ${typeof dataset.metadata.temperature_c === 'number' ? `${dataset.metadata.temperature_c}°C` : '温度未提供'} · ${dataset.metadata.corner === '未提供' ? 'Corner 未提供' : dataset.metadata.corner}`;
    rows = subset().filter(row => row.ro_id === get('wafer-ro').value);
    const allCoordinates = dataset.records.filter(row => waferOf(row) === get('wafer-id').value);
    const issue = rows.some(row => !Number.isFinite(row.wafer_x) || !Number.isFinite(row.wafer_y) || !Number.isFinite(row[config.field]));
    const positions = new Set(rows.map(row => `${row.wafer_x},${row.wafer_y}`));
    if (!rows.length || issue || positions.size !== rows.length || new Set(rows.map(keyOf)).size !== rows.length) {
      svg.append(element('text', { x: 60, y: 100, fill: '#9a442d', 'font-size': 16 }, !rows.length ? '当前筛选没有数据' : '坐标或 die 身份缺失、重复，无法绘制唯一 die 图'));
      get('wafer-scale-low').textContent = '—'; get('wafer-scale-high').textContent = '—';
      setList('wafer-statistics', [['Observed die', 0]]); get('wafer-die').replaceChildren(new Option('未选择', '')); highlight(selected); return;
    }
    const values = rows.map(row => row[config.field]).sort((first, second) => first - second);
    const lock = get('wafer-lock').checked;
    if (!lock) {
      minimum = values[0]; maximum = values.at(-1);
      if (ratioMode()) {
        const radius = Math.max(1 - minimum, maximum - 1, 0.0001);
        minimum = Math.max(0, 1 - radius);
        maximum = 1 + radius;
      } else if (minimum === maximum) {
        const padding = Math.abs(minimum) * 0.01 || 0.01;
        minimum -= padding;
        maximum += padding;
      }
      get('wafer-min').value = isFrequency(get('wafer-metric').value) ? displayFrequency(minimum) : minimum;
      get('wafer-max').value = isFrequency(get('wafer-metric').value) ? displayFrequency(maximum) : maximum;
    } else {
      minimum = Number(get('wafer-min').value); maximum = Number(get('wafer-max').value);
      if (isFrequency(get('wafer-metric').value)) { minimum = storedFrequency(minimum); maximum = storedFrequency(maximum); }
    }
    const validRange = get('wafer-min').value !== '' && get('wafer-max').value !== '' && Number.isFinite(minimum) && Number.isFinite(maximum) && minimum < maximum && (!ratioMode() || (minimum < 1 && maximum > 1));
    get('wafer-range-error').hidden = validRange;
    if (!validRange) {
      get('wafer-range-error').textContent = ratioMode() ? 'Ratio 色阶需要满足 MIN < 1 < MAX。' : '请输入有效色阶：MIN 必须小于 MAX。';
      return;
    }
    get('wafer-csv').disabled = false; get('wafer-svg').disabled = false;
    const outside = values.filter(value => value < minimum || value > maximum).length;
    get('wafer-scale-status').textContent = `${lock ? '固定色阶' : '自动色阶，仅适用于当前 cell'}${outside ? `；${outside} 个值超出范围，使用端点颜色` : ''}`;
    get('wafer-scale-low').textContent = format(minimum); get('wafer-scale-high').textContent = format(maximum);
    const colors = colorScale(minimum, maximum, ratioMode());
    colorbar.style.background = `linear-gradient(to right, ${colors.stops.map(([position, channels]) => `${rgb(channels)} ${position * 100}%`).join(', ')})`;
    midpoint.hidden = !ratioMode();
    if (ratioMode()) midpoint.style.left = `${colors.stops[1][0] * 100}%`;
    colorbar.parentElement.hidden = false;
    const xs = allCoordinates.map(row => row.wafer_x).filter(Number.isFinite), ys = allCoordinates.map(row => row.wafer_y).filter(Number.isFinite);
    const uniqueX = [...new Set(xs)].sort((first, second) => first - second), uniqueY = [...new Set(ys)].sort((first, second) => first - second);
    const xLow = uniqueX[0], xHigh = uniqueX.at(-1), yLow = uniqueY[0], yHigh = uniqueY.at(-1);
    const pitch = values => values.length < 2 ? 1 : Math.min(...values.slice(1).map((value, index) => value - values[index]));
    const pitchX = pitch(uniqueX), pitchY = pitch(uniqueY);
    const scale = Math.min(530 / (xHigh - xLow + 2 * pitchX), 485 / (yHigh - yLow + 2 * pitchY));
    const xMap = value => 380 + (value - (xLow + xHigh) / 2) * scale;
    const yMap = value => 285 - (value - (yLow + yHigh) / 2) * scale;
    const xTicks = uniqueX.length <= 14 ? uniqueX : uniqueX.filter((_, index) => index % Math.ceil(uniqueX.length / 12) === 0);
    const yTicks = uniqueY.length <= 14 ? uniqueY : uniqueY.filter((_, index) => index % Math.ceil(uniqueY.length / 12) === 0);
    for (const x of xTicks) svg.append(element('text', { x: xMap(x), y: 561, 'text-anchor': 'middle', fill: '#6c7d94', 'font-size': 13 }, x));
    for (const y of yTicks) svg.append(element('text', { x: 58, y: yMap(y) + 4, 'text-anchor': 'end', fill: '#6c7d94', 'font-size': 13 }, y));
    svg.append(element('text', { x: 380, y: 593, 'text-anchor': 'middle', fill: '#52647b', 'font-size': 15 }, 'Wafer X (die grid)'));
    svg.append(element('text', { transform: 'translate(22 285) rotate(-90)', 'text-anchor': 'middle', fill: '#52647b', 'font-size': 15 }, 'Wafer Y (die grid)'));
    for (const row of rows) {
      const width = pitchX * scale * 0.93, height = pitchY * scale * 0.93;
      const { fill, text } = colors.tone(row[config.field]);
      const die = element('rect', { x: xMap(row.wafer_x) - width / 2, y: yMap(row.wafer_y) - height / 2,
        width, height, rx: 3, fill, stroke: '#ffffff', 'stroke-width': 1.5,
        class: 'wafer-die', tabindex: 0, role: 'button', 'aria-label': `${row.die_id}, X ${row.wafer_x}, Y ${row.wafer_y}, ${config.label} ${format(row[config.field])}` });
      die.dataset.die = keyOf(row); die.dataset.value = row[config.field];
      die.addEventListener('pointerenter', event => tooltip(event, row)); die.addEventListener('pointermove', event => tooltip(event, row));
      die.addEventListener('pointerleave', () => { get('tooltip').hidden = true; });
      die.addEventListener('focus', event => tooltip(event, row)); die.addEventListener('blur', () => { get('tooltip').hidden = true; });
      die.addEventListener('click', () => select(keyOf(row)));
      die.addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); select(keyOf(row)); } });
      svg.append(die);
      if (width > 30 && height > 25) {
        svg.append(element('text', { x: xMap(row.wafer_x), y: yMap(row.wafer_y) + 4, 'text-anchor': 'middle', fill: text, 'font-size': 11, 'pointer-events': 'none' }, row.die_id));
      }
    }
    get('wafer-title').textContent = `${get('wafer-function').value} / ${get('wafer-vt').value} / ${get('wafer-drive').value} / ${get('wafer-height').value}`;
    get('wafer-subtitle').textContent = `${get('wafer-ro').value} · ${get('wafer-voltage').value} V · ${config.label}`;
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const median = values.length % 2 ? values[Math.floor(values.length / 2)] : (values[values.length / 2 - 1] + values[values.length / 2]) / 2;
    setList('wafer-statistics', [['Observed die', rows.length], ['Unit', isFrequency(get('wafer-metric').value) ? metric().label.match(/\(([^)]+)\)/)[1] : get('wafer-metric').value === 'ratio' ? 'Measure / Simulation' : '%'], ['Minimum', format(values[0])], ['Median', format(median)], ['Mean', format(mean)], ['Maximum', format(values.at(-1))]]);
    get('wafer-die').replaceChildren(new Option('未选择', ''));
    for (const row of [...rows].sort((first, second) => first.die_id.localeCompare(second.die_id))) get('wafer-die').add(new Option(row.die_id, keyOf(row)));
    get('wafer-condition').textContent = `${get('wafer-id').selectedOptions[0].textContent} · ${dataset.metadata.origin} · ${get('wafer-voltage').value} V / ${dataset.metadata.temperature_c}°C · ${dataset.metadata.corner} · ${dataset.metadata.simulation_version}`;
    highlight(readSelection());
  }
  for (const id of ['wafer-id', 'wafer-function', 'wafer-vt', 'wafer-drive', 'wafer-height', 'wafer-voltage']) get(id).addEventListener('change', updateRO);
  get('wafer-ro').addEventListener('change', render);
  get('wafer-metric').addEventListener('change', () => {
    if (get('wafer-metric').value !== lastMetric) get('wafer-lock').checked = false;
    lastMetric = get('wafer-metric').value;
    get('wafer-min').disabled = true; get('wafer-max').disabled = true; render();
  });
  get('wafer-lock').addEventListener('change', () => { get('wafer-min').disabled = !get('wafer-lock').checked; get('wafer-max').disabled = !get('wafer-lock').checked; render(); });
  for (const id of ['wafer-min', 'wafer-max']) get(id).addEventListener('change', render);
  get('wafer-die').addEventListener('change', event => select(event.target.value));
  get('wafer-clear').addEventListener('click', () => select(''));
  get('wafer-distribution').addEventListener('click', () => openDistribution({ function: get('wafer-function').value, vt: get('wafer-vt').value, drive: get('wafer-drive').value, cell_height: get('wafer-height').value, vdd_v: get('wafer-voltage').value, metric: get('wafer-metric').value }));
  get('wafer-csv').addEventListener('click', () => {
    const fields = ['lot_id', 'wafer_id', 'die_id', 'ro_id', 'function', 'vt', 'drive', 'cell_height', 'wafer_x', 'wafer_y', 'silicon_mean_frequency_mhz', 'simulation_frequency_mhz', 'silicon_sim_ratio', 'frequency_deviation_pct', 'repeat_count'];
    const headers = [...fields, 'vdd_v', 'temperature_c', 'corner', 'simulation_version', 'layout_version', 'data_origin', 'color_metric', 'color_min', 'color_max', 'color_unit'];
    const content = [headers, ...rows.map(row => [...fields.map(field => row[field]), row.vdd_v, dataset.metadata.temperature_c, dataset.metadata.corner, dataset.metadata.simulation_version, dataset.metadata.layout_version, dataset.metadata.origin, get('wafer-metric').value, minimum, maximum, isFrequency(get('wafer-metric').value) ? 'MHz' : get('wafer-metric').value === 'ratio' ? 'Measure/Simulation' : '%'])].map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
    save('wafer_cell.csv', `\uFEFF${content}`, 'text/csv;charset=utf-8');
  });
  get('wafer-svg').addEventListener('click', () => {
    if (!container.querySelector('.wafer-die')) return;
    const svg = get('wafer-map').cloneNode(true); svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.setAttribute('viewBox', '0 -65 720 755'); svg.setAttribute('width', 720); svg.setAttribute('height', 755);
    svg.prepend(element('rect', { x: 0, y: -65, width: 720, height: 755, fill: '#ffffff' }));
    svg.append(element('text', { x: 60, y: -38, fill: '#23334b', 'font-size': 18 }, `${get('wafer-title').textContent} | ${metric().label}`));
    svg.append(element('text', { x: 60, y: -15, fill: '#52647b', 'font-size': 12 }, get('wafer-condition').textContent));
    const scaleDescription = ratioMode()
      ? `${format(minimum)} (blue) · 1.0 (neutral) · ${format(maximum)} (red)`
      : `${format(minimum)} (light) to ${format(maximum)} (dark)`;
    svg.append(element('text', { x: 60, y: 625, fill: '#52647b', 'font-size': 13 }, `Scale: ${scaleDescription}. No spatial interpolation.`));
    const gradient = element('linearGradient', { id: 'wafer-export-gradient' });
    for (const [position, channels] of colorScale(minimum, maximum, ratioMode()).stops) {
      gradient.append(element('stop', { offset: position, 'stop-color': rgb(channels) }));
    }
    const definitions = element('defs'); definitions.append(gradient); svg.append(definitions);
    svg.append(element('rect', { x: 60, y: 640, width: 400, height: 16, fill: 'url(#wafer-export-gradient)' }));
    save('wafer_cell.svg', new XMLSerializer().serializeToString(svg), 'image/svg+xml');
  });
  updateRO();
  return { render, highlight };
}
