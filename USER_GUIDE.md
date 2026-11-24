# Silicon Lab — analysis_1.csv 单输入便携版

版本：2026-11-24 matrix v1。本包已经支持 Cell height、Voltage、Function、VT、Drive、箱线图、P-plot、voltage sweep 和 Wafer view。

**每次只读取一份输入文件：包根目录的 analysis_1.csv。** 不需要其他原始 CSV、PID 对照表、配置 JSON 或之前生成的汇总。内置文件是72 die、两种height、四电压的示例；H300的性能差异为人为设定，不能作为真实工艺结论。

## 1. 首次使用

需要 Python **3.10+** 和现代浏览器。无需 Node.js、npm、pip、matplotlib 或网络 CDN。适用于 Windows/macOS/Linux 的标准 Python 环境；本包在 macOS 实测，Windows/Linux 尚未实机验证。

1. 解压整个 ZIP 到有写入权限的目录，不能在压缩包内启动。
2. 首次可直接使用附带的 analysis_1.csv 验证平台。
3. Windows 双击 `START_WINDOWS.bat`；macOS 双击 `START_MAC.command`。Linux 在终端执行 `sh START_LINUX.sh`。
4. 程序处理 CSV 后自动打开本机网页。若没有自动打开，复制终端的 `Open:` 地址到浏览器。
5. 使用期间保留终端窗口，按 Ctrl+C 停止。

如果双击不便，直接在解压目录的终端运行：

Windows：

```powershell
py -3 run.py
```

macOS / Linux：

```bash
python3 run.py
```

Windows 安装 Python 时勾选 Add Python to PATH。macOS 若提示 command 文件不能执行，可在终端用 `sh START_MAC.command` 或 `python3 run.py`；按系统提示检查文件来源和执行权限。

## 2. 换一份输入文件

1. 在运行窗口按 Ctrl+C 结束服务。
2. 用新文件替换包根目录的 **analysis_1.csv**，文件名不变、格式保持相同。
3. 再次双击启动文件或运行同一命令。
4. 浏览器使用本次终端输出的地址；若旧页面仍打开，刷新即可。

**程序在启动时读取文件，更换 CSV 后需要重启；仅刷新浏览器不会重新处理原始文件。** 输入不会被改写；同一 runtime 目录中的生成结果会更新。

也可以不改文件名，指定路径：

```powershell
py -3 run.py --input "D:\RO Data\my_analysis.csv"
```

```bash
python3 run.py --input "/Users/me/RO Data/my_analysis.csv"
```

多个分析批次要分别保留结果，可加 `--output run_A`。默认输入和 runtime 路径相对于 run.py 所在目录；显式提供的相对路径相对于终端当前目录。路径中有空格时加双引号。

## 3. 输入格式

UTF-8 或 UTF-8 BOM 编码的逗号分隔 CSV。第一行示例：

```csv
Parameter,Tests#,Unit,HighL,LowL,PID-1,PID-2,PID-3
```

样品列名以 `PID-` 开头，数量可以变化。当前文件包含 PID-1 到 PID-72。每个 PID 列代表一枚 die；同一 lot/wafer/X/Y 不应重复占多个 PID 列，否则会拒绝以免误算独立样本数。

### 必须提供的样品信息行

```csv
LOT_ID,,,,,LOT01,LOT01,LOT01
WAFER_ID,,,,,7,7,7
DIE_X,,,,,4,5,8
DIE_Y,,,,,8,8,7
```

SBIN、HBIN、SITE、TIME、TOTAL_TESTS 可以保留，但当前不会用 bin 编号自动筛除样品。Tests#、HighL、LowL 也不用于判定性能合格性。

### 每个 cell/voltage 三行

```csv
ND2_SVT_D1_H243_0P75V_Simulation,,hz,,,1001,1001,1001
ND2_SVT_D1_H243_0P75V_Measure,,hz,,,1012,1012,1012
ND2_SVT_D1_H243_0P75V_Ratio,,%,,,101.10,101.10,101.10
```

参数命名：`Function_VT_Drive_CellHeight_Voltage_Kind`。

| 字段 | 示例及规则 |
| --- | --- |
| Function | ND2、ND3、NR2、INV；单个字段内不能有下划线 |
| VT | SVT、LVTLL、LVT、ULVTLL、ULVT、ELVT，按输入读取 |
| Drive | D1/D2/D4，或其他输入标识，按输入读取 |
| Cell height | H243/H300；必须以 H 开头，保留标签，不假定长度单位 |
| Voltage | 0P55V、0P75V、0P80V、1P10V；P 代表小数点 |
| Kind | 严格为 Simulation、Measure、Ratio |

同一配置的三行必须齐全，参数名必须唯一。不要用同名参数表示多次重复测量；当前格式没有 repeat ID，无法分辨它们。

### 单位及比值

- Simulation 和 Measure 的 Unit 支持 Hz/kHz/MHz/GHz，不区分大小写，内部统一转为 MHz。
- Ratio 的 Unit 必须为 `%`，数值等于 `100 × Measure / Simulation`；101.10 表示约1.011倍，不是频率偏差101.10%。
- ratio 会重新计算，并核对输入值。允许倍数绝对误差0.00005，即百分比值0.005的舍入误差，适配两位小数百分比。
- 平台的 deviation = `100 × (Measure / Simulation − 1)`，因此 Ratio 101.10% 对应 deviation约+1.10%。
- 每个电压必须有其对应的 Simulation，不能把0.80V仿真作为所有电压的分母。
- 所有数值须有限、频率和ratio为正。三项全部空白时，该 die/配置作为缺测跳过；部分空白则报错。
- Measure 可能已经是外部汇总结果。本格式没有重复次数、温度、corner、模型和layout版本，平台统一显示未知，不自动填入旧数据。

## 4. 分析页面

### 比较 height

Group by 选择 **Cell height**，固定 Function、VT、Drive 和 Voltage。左侧箱线图，右侧P-plot；Metric可选Frequency、Ratio、Deviation。点击点或从下拉选择die可跨图高亮。

### 同 height 跨 voltage

Group by 选择 **Voltage**，固定cell height、Function、VT、Drive，再确认RO。默认比较所有电压共有的同一批die；关闭配对选项可看每个电压的所有可用样本，留意n的变化。下面的sweep连接同一die的观测点，不拟合或外推。

### 比较 VT / Function / Drive

Group by选择相应维度，固定其他维度，尤其注意height和voltage。平台按输入数据生成可选枚举；若某组合未测，显示无数据，不用其他组合补齐。

### Wafer view

选择wafer、Function、VT、Drive、Voltage、Cell height和RO ID。颜色表示每个die的观测值。自动色阶用于当前配置；跨height/cell/voltage比较时锁定相同色阶。缺测留空，不做插值，坐标范围不代表晶圆真实边缘。

所有图形可导出CSV或SVG。Data quality展示本次输入的观测数和核对结果。

## 5. 输出文件

```text
runtime/
  processed/
    die_ro_summary.csv         从唯一输入整理出的长表
    ratio_checks.csv           输入/重算ratio核对
    validation_report.json     输入路径、SHA256、样本与观测计数
    analysis_report.txt        分析摘要及未知条件说明
    height_comparison.csv      若存在H243/H300配对则输出描述统计
  web/                        本次页面及生成数据
```

当前height配对统计专门输出H300相对H243，其他height仍可在页面中分组比较。报告不是物理工艺归因。

同一output目录会更新同名结果。不同批次建议用不同目录，避免将旧批次输出误认为新结果。原CSV不会被修改。

## 6. 参数与排错

```bash
python3 run.py --port 8766
python3 run.py --input analysis_1.csv --output run_A --prepare-only
python3 run.py --no-browser
```

| 情况 | 处理 |
| --- | --- |
| 找不到Python | 安装Python3.10+，Windows用py -3，macOS/Linux用python3 |
| Input CSV not found | 把文件放在run.py旁并命名analysis_1.csv，或使用--input |
| Unrecognized measurement parameter | 检查命名中的字段、P小数点、V后缀和Simulation/Measure/Ratio拼写 |
| Duplicate parameter / Incomplete triplet | 检查同名行及缺少的三行；不会自动去重或猜测配对 |
| Ratio mismatch | 检查是否为百分比、频率单位及该电压下的仿真值 |
| Unsupported frequency unit | Unit需明确填写hz/khz/mhz/ghz，不能留空 |
| Required metadata / 重复die坐标 | 检查LOT_ID、WAFER_ID、DIE_X、DIE_Y及样品身份 |
| 端口被占用 | 关闭旧服务，或用--port 8766；打开新打印的URL |
| 处理成功但浏览器没开 | 手动复制Open地址，保持终端运行 |
| 页面仍显示旧数据 | 先停止旧服务，再重新启动，不要只刷新 |
| 修改CSV后出现错误 | 先看终端和输入格式；失败时不启动网页服务 |

服务只监听127.0.0.1，供本机使用，不上传数据，也不开放给其他电脑访问。每台电脑分别解压、安装Python并运行即可。
