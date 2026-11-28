# Silicon Lab

本地 Post-Silicon Ring Oscillator 分析平台。以单份 `analysis_1.csv` 参数矩阵为数据输入，支持不同 Function、VT、Drive、Cell height 与 Voltage 的比较。

## 功能（v4.4）

- 箱线图与 P-plot 并列，支持 **Simulation、Measure、Ratio、Deviation** 四种 metric。
- Function、VT、Drive、Cell height、Voltage 可在各自的下拉框内搜索、单选、多选或全选。切换 Group by 会保留各维度的勾选。
- 按完整 cell 和电压配置分别统计。超过 60 组时图表分页，CSV 包含全部所选组。
- 同一 cell 跨电压的分布与 voltage sweep，按每个 cell 分别求所选电压共有的配对 die；多 cell 选择时以完整配置分布对比。
- Wafer view 支持锁定色阶和 die 选择联动。Ratio 以 1.0 为浅灰中点，低于 1 越低越蓝，高于 1 越高越红。
- 图表和 Wafer view 支持切换 Hz、kHz、MHz、GHz。
- CSV 与 SVG 导出、输入 ratio 核对。
- 电压兼容 `0.75V` 和 `0P75V`，同一配置的三种 metric 可以混用写法。
- Cell height 按输入标签识别，支持 `6T`、`7.5T`、`LIB_8T` 等类型。Height 配对报告按实际标签生成，并标明比较方向。

## 启动

需要 Python 3.10+ 和现代浏览器，无第三方 Python/Node.js 依赖。

```bash
# macOS / Linux
python3 run.py
```

```powershell
# Windows
py -3 run.py
```

也可以使用 `START_WINDOWS.bat`、`START_MAC.command` 或 `sh START_LINUX.sh`。程序处理 CSV 后自动打开本机网页，按 Ctrl+C 停止。

## 更换数据

停止运行，用相同格式的新文件替换根目录 `analysis_1.csv`，重新启动即可。也支持：

```bash
python3 run.py --input "/path/to/analysis.csv" --output run_A --port 8766
```

输入格式、字段、操作说明及故障排查见 [USER_GUIDE.md](USER_GUIDE.md)。程序只在启动时读取 CSV，替换后需要重启。

## 示例与限制

附带的 `analysis_1.csv` 全部为合成示例：72 die、H243/H300、四电压。H300 的 simulation/Measure 性能差异由人为设定，不代表真实工艺结论。

未提供的温度、corner、版本和重复次数保持未知。当前支持本机使用；服务不上传数据，生成文件存于 `runtime/`。仓库不包含用户的真实生产测试数据。

macOS 已验证处理与页面交互；Windows/Linux 使用标准库启动接口，尚未实机验证。

## 分发

源码放在仓库。便携 ZIP 建议作为 GitHub Release 附件分发；上传源码本身不会自动部署在线平台。
