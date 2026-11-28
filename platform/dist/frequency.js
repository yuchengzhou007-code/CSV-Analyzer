// Storage and CSV exports stay in MHz; only presentation uses the selected unit.
const scales = { Hz: 1e6, kHz: 1e3, MHz: 1, GHz: 0.001 };
let unit = 'MHz';
export const frequencyUnit = () => unit;
export const displayFrequency = value => value * scales[unit];
export const storedFrequency = value => value / scales[unit];
export const isFrequency = metric => ['frequency', 'simulation'].includes(metric);
export function numeric(value, precision = 8) {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return '0';
  return Number(value.toPrecision(precision)).toString();
}
export const frequencyText = value => `${numeric(displayFrequency(value), 10)} ${unit}`;
export function metricLabel(key, fallback) {
  return isFrequency(key) ? `${key === 'simulation' ? 'Simulation' : 'Measure'} frequency (${unit})` : fallback;
}
export function metricNumber(value, key, digits = 4) {
  return isFrequency(key) ? numeric(displayFrequency(value)) : value.toFixed(digits);
}
export function metricTick(value, key, step) {
  if (!isFrequency(key)) return metricNumber(value, key, key === 'ratio' ? 3 : 2);
  const displayed = displayFrequency(value), spacing = Math.abs(displayFrequency(step));
  const digits = Math.max(0, Math.min(14, 1 - Math.floor(Math.log10(spacing || 1))));
  return Math.abs(displayed) >= 1e10 || (Math.abs(displayed) > 0 && Math.abs(displayed) < 1e-5)
    ? numeric(displayed, 10) : displayed.toFixed(digits);
}
export function mountFrequencyUnit(parent, id) {
  const label = document.createElement('label'); label.textContent = 'FREQUENCY UNIT';
  const select = document.createElement('select'); select.id = id;
  select.setAttribute('aria-label', 'Frequency display unit');
  for (const name of Object.keys(scales)) select.add(new Option(name, name));
  select.value = unit; label.append(select); parent.append(label);
  select.addEventListener('change', () => {
    const previous = unit; unit = select.value;
    for (const control of document.querySelectorAll('[data-frequency-unit]')) control.value = unit;
    window.dispatchEvent(new CustomEvent('frequency-unit-change', { detail: { previous, unit } }));
  });
  select.dataset.frequencyUnit = '';
}
