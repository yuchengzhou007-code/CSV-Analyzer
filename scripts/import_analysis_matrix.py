import argparse
import csv
import hashlib
import json
import re
import statistics
from collections import defaultdict
from decimal import Decimal
from itertools import combinations
from pathlib import Path


PATTERN = re.compile(
    r'(?P<function>[^_]+)_(?P<vt>[^_]+)_(?P<drive>[^_]+)_'
    r'(?P<cell_height>[^_]+(?:_[^_]+)*)_'
    r'(?P<voltage>\d+[.P]\d+)V_(?P<kind>Simulation|Measure|Ratio)'
)
RO_FIELDS = ('function', 'vt', 'drive', 'cell_height')


def number(value, positive=False):
    result = Decimal(value)
    if not result.is_finite() or (positive and result <= 0):
        raise ValueError(f'Invalid number: {value}')
    return result


def main(source, output, web_data):
    raw = source.read_bytes()
    with source.open(encoding='utf-8-sig', newline='') as stream:
        reader = csv.DictReader(stream)
        fields = reader.fieldnames
        if not fields or len(set(fields)) != len(fields):
            raise ValueError('Invalid/duplicate headers')
        pids = [field for field in fields if field.startswith('PID-')]
        if not pids:
            raise ValueError('No PID sample columns')
        table = list(reader)
    metadata, groups = {}, {}
    for line, row in enumerate(table, start=2):
        if None in row or any(value is None for value in row.values()):
            raise ValueError(f'Line {line}: inconsistent column count')
        name = row['Parameter'].strip()
        parsed = PATTERN.fullmatch(name)
        if parsed:
            parts = parsed.groupdict()
            parts['cell_height'] = parts['cell_height'].strip()
            if not parts['cell_height']:
                raise ValueError(f'Missing cell height: {name}')
            voltage = number(parts['voltage'].replace('P', '.'), True)
            ro = tuple(parts[field] for field in RO_FIELDS)
            stem = name.rsplit('_', 1)[0]
            group = groups.setdefault((*ro, voltage), {'stem': stem, 'parts': parts, 'rows': {}})
            if parts['kind'] in group['rows']:
                raise ValueError(f'Duplicate parameter for the same RO and voltage: {name}')
            group['rows'][parts['kind']] = row
        elif re.search(r'_(Simulation|Measure|Ratio)$', name):
            raise ValueError(f'Unrecognized measurement parameter: {name}')
        else:
            if name in metadata:
                raise ValueError(f'Duplicate metadata: {name}')
            metadata[name] = row
    required = ['LOT_ID', 'WAFER_ID', 'DIE_X', 'DIE_Y']
    if any(key not in metadata for key in required):
        raise ValueError(f'Required metadata rows: {required}')
    identities = {}
    for pid in pids:
        lot, wafer = metadata['LOT_ID'][pid].strip(), metadata['WAFER_ID'][pid].strip()
        x, y = number(metadata['DIE_X'][pid]), number(metadata['DIE_Y'][pid])
        if not lot or not wafer:
            raise ValueError(f'Missing lot/wafer: {pid}')
        identity = (lot, wafer, str(x.normalize()), str(y.normalize()))
        if identity in identities:
            raise ValueError(f'Multiple PID columns for same die coordinates: {identities[identity]}, {pid}')
        identities[identity] = pid
    records, checks = [], []
    factors = {'hz': Decimal('0.000001'), 'khz': Decimal('0.001'), 'mhz': Decimal(1), 'ghz': Decimal(1000)}
    skipped = 0
    for config, group in groups.items():
        stem = group['stem']
        if set(group['rows']) != {'Simulation', 'Measure', 'Ratio'}:
            raise ValueError(f'Incomplete triplet: {stem}')
        parts = group['parts']
        voltage = config[-1]
        ro_id = '_'.join(config[:-1])
        for pid in pids:
            values = {kind: row[pid].strip() for kind, row in group['rows'].items()}
            if not any(values.values()):
                skipped += 1
                continue
            if not all(values.values()):
                raise ValueError(f'Incomplete values: {stem}/{pid}')
            frequencies = {}
            for kind in ['Simulation', 'Measure']:
                unit = group['rows'][kind]['Unit'].strip().lower()
                if unit not in factors:
                    raise ValueError(f'Unsupported frequency unit: {unit}')
                frequencies[kind] = number(values[kind], True) * factors[unit]
            if group['rows']['Ratio']['Unit'].strip() != '%':
                raise ValueError('Ratio unit must explicitly be %')
            supplied = number(values['Ratio'], True) / 100
            ratio = frequencies['Measure'] / frequencies['Simulation']
            tolerance = Decimal('0.00005')
            if abs(supplied - ratio) > tolerance:
                raise ValueError(f'Ratio mismatch: {stem}/{pid}; input={supplied}, computed={ratio}')
            records.append({
                'lot_id': metadata['LOT_ID'][pid], 'wafer_id': metadata['WAFER_ID'][pid],
                'die_id': pid, 'ro_id': ro_id,
                **{field: parts[field] for field in RO_FIELDS},
                'vdd_v': float(voltage), 'wafer_x': float(number(metadata['DIE_X'][pid])),
                'wafer_y': float(number(metadata['DIE_Y'][pid])),
                'silicon_mean_frequency_mhz': float(frequencies['Measure']),
                'simulation_frequency_mhz': float(frequencies['Simulation']),
                'silicon_sim_ratio': float(ratio), 'frequency_deviation_pct': float((ratio - 1) * 100),
                'repeat_count': None, 'repeat_cv_pct': None,
            })
            checks.append({'parameter': stem, 'pid': pid, 'input_ratio': str(supplied),
                           'computed_ratio': str(ratio), 'absolute_difference': str(abs(supplied - ratio))})
    if not records:
        raise ValueError('No valid observations')
    voltages = sorted({row['vdd_v'] for row in records})
    validation = {'source_rows': {source.name: len(table)}, 'matched_measurements': len(records),
                  'excluded_measurements': skipped, 'issue_count': 0,
                  'unique_matched_dies': len(pids), 'ro_type_groups': len(groups),
                  'unique_ro_types': len({row['ro_id'] for row in records}),
                  'input_kind': 'analysis_matrix', 'source_sha256': hashlib.sha256(raw).hexdigest(),
                  'only_input_file': str(source.resolve()), 'ratio_checked_rows': len(checks)}
    payload = {'metadata': {'dataset': source.stem, 'input_format': 'analysis_matrix',
                            'vdd_v': 0.8 if 0.8 in voltages else voltages[0], 'voltages_v': voltages,
                            'temperature_c': '未提供', 'corner': '未提供', 'simulation_version': '未提供',
                            'layout_version': '未提供', 'origin': 'CSV_INPUT',
                            'source_sha256': validation['source_sha256'],
                            'source_file': source.name, 'repeat_count_known': False},
               'validation': validation, 'records': records}
    output.mkdir(parents=True, exist_ok=True)
    for name, rows in [('die_ro_summary.csv', records), ('ratio_checks.csv', checks)]:
        with (output / name).open('w', encoding='utf-8-sig', newline='') as stream:
            writer = csv.DictWriter(stream, fieldnames=list(rows[0])); writer.writeheader(); writer.writerows(rows)
    pairs = defaultdict(dict)
    for row in records:
        key = tuple(row[field] for field in ['lot_id', 'wafer_id', 'die_id', 'function', 'vt', 'drive', 'vdd_v'])
        pairs[key][row['cell_height']] = row
    comparisons = defaultdict(list)
    for key, heights in pairs.items():
        for baseline, target in combinations(sorted(heights), 2):
            first, second = heights[baseline], heights[target]
            comparisons[(*key[3:], baseline, target)].append((
                second['silicon_mean_frequency_mhz'] / first['silicon_mean_frequency_mhz'],
                second['simulation_frequency_mhz'] / first['simulation_frequency_mhz'],
                second['silicon_sim_ratio'] / first['silicon_sim_ratio'],
            ))
    compared = []
    comparison_fields = ['function', 'vt', 'drive', 'vdd_v', 'baseline_height', 'target_height']
    for key, values in comparisons.items():
        compared.append(dict(zip(comparison_fields, key), paired_die_count=len(values),
                             mean_silicon_gain_pct=100 * (statistics.mean(value[0] for value in values) - 1),
                             mean_simulation_gain_pct=100 * (statistics.mean(value[1] for value in values) - 1),
                             mean_ratio_relative_change_pct=100 * (statistics.mean(value[2] for value in values) - 1)))
    with (output / 'height_comparison.csv').open('w', encoding='utf-8-sig', newline='') as stream:
        fields = [*comparison_fields, 'paired_die_count', 'mean_silicon_gain_pct',
                  'mean_simulation_gain_pct', 'mean_ratio_relative_change_pct']
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        writer.writerows(compared)
    report_lines = [f'唯一输入：{source.resolve()}', f'SHA256：{validation["source_sha256"]}',
                    f'独立 die：{len(pids)}；RO（含 height）：{validation["unique_ro_types"]}；cell/voltage 配置：{len(groups)}；观测数：{len(records)}',
                    f'Ratio 核对通过：{len(checks)}；电压：{voltages} V。',
                    '频率按源文件 Unit 转为 MHz，百分比 ratio 除以 100 后与 Measure/Simulation 核对。',
                    '源文件未提供 temperature/corner/model/layout/repeat count；均标记未知，未读取其他数据文件补入。',
                    'PID 是源 CSV 的样品列身份，未借用外部 PID 对照表。',
                    'Height 对比是配对描述统计；数据来源及物理原因无法仅由数值确认。']
    if compared:
        report_lines.append(f'已输出 {len(compared)} 条 height 配对统计，比较方向见 baseline_height 和 target_height。')
    (output / 'analysis_report.txt').write_text('\n'.join(report_lines) + '\n', encoding='utf-8')
    (output / 'validation_report.json').write_text(json.dumps(validation, ensure_ascii=False, indent=2), encoding='utf-8')
    web_data.parent.mkdir(parents=True, exist_ok=True)
    web_data.write_text(json.dumps(payload, separators=(',', ':'), allow_nan=False), encoding='utf-8')
    print(json.dumps(validation, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Use a single parameter-by-PID analysis CSV as the sole data source')
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=Path('outputs/analysis_1_review'))
    parser.add_argument('--web-data', type=Path, default=Path('platform/dist/data.json'))
    arguments = parser.parse_args()
    main(arguments.input, arguments.output, arguments.web_data)
