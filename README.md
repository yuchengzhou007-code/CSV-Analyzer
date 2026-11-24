# Silicon Lab

本地 Post-Silicon Ring Oscillator 分析平台。以单份 `analysis_1.csv` 参数矩阵为数据输入，支持不同 Function、VT、Drive、Cell height 与 Voltage 的比较。

## 功能

- 箱线图与 P-plot 并列，支持 frequency、silicon/simulation ratio、频率偏差。
- 同一 cell 跨电压的分布与 voltage sweep，支持配对 die。
- Wafer view、固定色阶、die 选择联动。
- CSV 与 SVG 导出、输入 ratio 核对。

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
