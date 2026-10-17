# Code Tutor · 独立悬浮代码助教

一个独立于 DSH（DeepSeek Harness）运行的**悬浮代码助教**：常驻桌面的 Electron 小窗口，面向单片机初学者（Keil / STM32 场景），支持对话教学、真实读文件、真实命令行编译检验、函数规划、历史记录与多任务多开。

> 定位：**行动型 agent**——不只是"能说"，还能"读你的代码、跑编译、拿真实输出说话"。

![screenshot](docs/screenshot-placeholder.png)

---

## ✨ 功能

### 教学交互
- **函数规划**：说"我要写 iic"→ 先给函数清单（名字+作用+参数），**规划阶段绝不给代码**，逼你自己动手
- **检验代码**：一键真实读取你的 `.c/.h` 文件 → 调用 Keil 命令行（`UV4.exe -b`）真实编译 → 把代码+编译输出喂给 LLM 综合判定（结论以编译输出为准，`0 Error` = 通过）
- **给我代码**：卡住时给出当前函数的完整实现 + 逐段讲解
- **选项交互**：需要决策时（用方案 A 还是 B？）自动出现 A/B/C/D 选项按钮，点选即回复
- **HTML 图示**：LLM 回答中的 ` ```html ` 代码块（时序图/架构图）渲染成沙箱 iframe 图示，附查看源码/复制按钮

### 窗口体验
- 无边框、置顶、可拖动、**可缩放**（边缘拖拽）、可收起成小球、最小化到托盘
- 不随 DSH 最小化/关闭而消失（独立进程）
- LLM 回答完整 **Markdown 渲染**（标题/代码块/表格/引用，先转义再解析，无注入风险）

### 记忆库（Obsidian 集成）
- 每轮对话自动追加到 Obsidian 库：`任务-<名称>/对话记录/YYYY-MM-DD.md`
- **父库索引**：`00-索引.md` 自动登记所有任务子库的位置与最近活跃时间
- **历史面板**：窗口内按日期/任务浏览全部历史
- **从此继续**：选中某天的某轮对话，一键载入上下文接着聊
- **跨任务跳转**：在历史面板翻到其他任务的对话 → 直接拉起那个任务的窗口并预载上下文
- **自动分类**：对话保存时自动判断属于哪个任务（关键词匹配 + LLM 判主题），归属其他任务则自动搬到对应子库

> **Obsidian 在本项目中的作用（详见下方「记忆库与 Obsidian」）**：它只是"存储格式"——本项目不依赖 Obsidian 本体也能运行；装了 Obsidian 只是让你能用它优秀的 Markdown 编辑/双链/图形界面来浏览这些自动生成的对话档案。

### 多任务多开
- 每个任务（iic / gpio / delay / spi…）一个独立窗口实例，标题栏带任务名
- 同任务重复启动自动聚焦已有窗口；不同任务互不干扰（独立端口、独立存储）
- 标题栏 **＋** 按钮直接拉起新任务窗口

---

## 📦 仓库结构

```
code-tutor/                 悬浮窗本体（Electron 应用）
├── main.js                 主进程：窗口管理、HTTP 控制服务、记忆库、Keil 编译、任务分类
├── preload.js              预加载：渲染进程 ↔ 主进程桥（contextIsolation）
├── index.html              渲染层：UI、Markdown 渲染、历史面板
├── _launch_task.bat        多实例启动壳（清 ELECTRON_RUN_AS_NODE 后分离启动）
├── 启动悬浮窗.cmd          Windows 启动器（支持任务名/端口参数）
└── gen-tray-icon.js        托盘图标生成脚本

dsh-code-tutor-bridge/      DSH 桥接插件（可选，增强功能）
├── index.js                DSH 侧：悬浮窗 ↔ DSH 内置 LLM 的 HTTP 桥、classify 分类路由
├── client.js               DSH Web 界面的 "CT" 启动按钮（客户端插件）
├── cordis.patch.yml        DSH profile 配置补丁
└── install.ps1             打包安装脚本
```

---

## 🚀 快速开始

### 一键安装（推荐，DSH 用户）

装好 [git](https://git-scm.com) 和 [Node.js](https://nodejs.org) 后，在 PowerShell 里执行一条命令（发布后把 `<user>` 换成真实仓库地址）：

```powershell
irm https://raw.githubusercontent.com/lqi02965-boop/code-tutor/main/install.ps1 | iex
```

脚本会自动完成：
1. 从 GitHub 克隆/更新源码到 `~\code-tutor\code-tutor-src`
2. 检测本机 DSH → 自动打包安装桥接插件到 desktop profile（无 DSH 则跳过，悬浮窗仍可用自定义 LLM 后端）
3. 初始化悬浮窗目录 `~\code-tutor\code-tutor\`，并把源码里的演示路径**自动替换**为你的安装路径
4. 创建 `aux_files\context\` 目录（会话上下文文件位置）
5. 检查 Electron 运行时；没有则给出三条获取途径（官方 release / npm / 复制 DSH 内置的）

已克隆过再跑一次 = 增量更新。装完**重启 DSH 桌面端**，Web 界面左下角会出现 "CT" 按钮拉起悬浮窗；也可以直接双击 `~\code-tutor\code-tutor\启动悬浮窗.cmd`。

<details>
<summary>手动安装（逐步执行）</summary>

#### 1. 获取源码

```powershell
git clone https://github.com/lqi02965-boop/code-tutor ~/code-tutor/code-tutor-src
```

#### 2. 安装 DSH 桥接插件（可选，推荐）

桥接插件让悬浮窗复用 DSH 会话里配置的 LLM 路由（如 workbuddy / deepseek-v4.1-flash）：

```powershell
cd ~/code-tutor/code-tutor-src/dsh-code-tutor-bridge
.\install.ps1               # 打包 → 安装到 DSH desktop profile
```

然后**重启 DSH 桌面端**。DSH Web 界面左下角会出现 "CT" 按钮，点击即可拉起悬浮窗。

#### 3. 初始化悬浮窗

把 `code-tutor/` 下的 `main.js`、`preload.js`、`index.html`、`_launch_task.bat`、`启动悬浮窗.cmd` 复制到运行目录（如 `~\code-tutor\code-tutor\`），**并把 `main.js` 里的演示路径改成你的**（一键脚本会自动做这一步）。Electron 运行时放进同一目录。

</details>

### 启动悬浮窗

```cmd
cd %USERPROFILE%\code-tutor\code-tutor
启动悬浮窗.cmd              REM 默认任务 default，端口 19290
启动悬浮窗.cmd gpio         REM 任务 gpio，端口 19291
启动悬浮窗.cmd spi 19292    REM 指定任务名与端口
```

> ⚠️ 启动器会清 `ELECTRON_RUN_AS_NODE`——若你从设置了该变量的环境（如 DSH 宿主）里直接 spawn electron，窗口会变成纯 Node 模式秒退。

### 用起来

1. 悬浮窗里说 **"我要写 iic"** → 得到函数规划清单（只有清单，没有代码）
2. 自己在 Keil/VSCode 里写代码
3. 写完点 **【检验代码】** → 真实编译 + AI 综合判定
4. 卡住点 **【给我代码】** → 当前函数实现 + 讲解
5. 点 **【历史】** 回看/续聊任意一天的对话

---
## ⚙️ 配置

悬浮窗的本地路径配置集中在 `code-tutor/main.js` 顶部，**按你的机器修改**：

```js
// Keil（检验代码的真实编译）
const KEIL_UV4      = 'D:\\keil\\UV4\\UV4.exe';
const KEIL_PROJECT  = 'D:\\stm32\\c8t6\\project\\c8t6.uvprojx';

// 允许 AI 读取的目录白名单（文件读取/工程列表功能）
const READABLE_ROOTS = ['D:\\stm32\\c8t6', 'D:\\办公任务\\aux_files', ...];

// 记忆库（Obsidian）根目录；每个任务的对话存到 任务-<名称>/对话记录/
const VAULT_ROOT = 'D:\\knowledge\\CodeTutor记忆';
```

桥接插件的任务人格/工程上下文在 `dsh-code-tutor-bridge/index.js` 的 `SYSTEM_PROMPT` 与 `cordis.patch.yml` 里，改成你自己的项目。

### LLM 接入

| 方式 | 说明 |
|---|---|
| **DSH 桥接**（默认推荐） | 安装桥接插件后，悬浮窗通过 `http://127.0.0.1:19387/code-tutor/chat` 走 DSH 会话配置的 LLM 路由。路由规则由你的 DSH profile 决定 |
| 自定义后端 | 改 `main.js` 里 `askBridge()`，把请求发到任何 OpenAI 兼容接口 |

> 本项目不内置任何 API Key。请遵守你自己 LLM 提供方的用量与付费条款。

### 端口约定

| 端口 | 用途 |
|---|---|
| `19290` | default 任务实例的控制端口 |
| `19291-19299` | 其他任务实例（自动分配，找第一个空闲的） |
| `19387` | DSH Web GUI（桥接插件的服务所在，同源） |

---

## 🧠 硬件信息（很重要，直接影响回答质量）

Code Tutor 的回答质量**高度依赖它知道你在用什么硬件**：芯片型号决定头文件、时钟树、寄存器定义；外设（OLED/传感器）决定驱动协议和从机地址；引脚分配决定 `GPIO_Init` 的配置。

**当前版本**：硬件信息写死在 `dsh-code-tutor-bridge/index.js` 的 `SYSTEM_PROMPT` 里（示例是一块 STM32F103C8T6 + 0.96 寸 SSD1306 OLED + 软件 IIC）。新用户需要把它改成自己的板子。

**改成你的硬件（当前做法，改一行即可）**：

```js
// dsh-code-tutor-bridge/index.js · SYSTEM_PROMPT 里这一行
'当前工程：D:\\stm32\\c8t6，STM32F103C8，标准外设库，软件 IIC（PB8=SCL，PB9=SDA），目标 0.96 寸 OLED（SSD1306，IIC 地址 0x78）。',
// ↓ 换成你的
'当前工程：D:\\你的工程路径，STM32F407VGT6，HAL 库，硬件 SPI1（PA5=SCK，PA6=MISO，PA7=MOSI），目标 1.3 寸 OLED（SH1106）。',
```

改完执行 `install.ps1` 重装插件并重启 DSH。

**建议提供的硬件信息清单**（越全，AI 答得越准）：

| 信息 | 示例 | 为什么需要 |
|---|---|---|
| MCU 型号 | STM32F103C8T6 | 决定头文件、Flash/RAM 大小、时钟树、启动文件 |
| 库类型 | 标准外设库 / HAL / LL | 函数名完全不同（`GPIO_Init` vs `HAL_GPIO_Init`） |
| 外设清单 | 0.96" OLED (SSD1306) | 决定驱动协议、从机地址、初始化序列 |
| 引脚分配 | PB8=SCL, PB9=SDA | 决定 GPIO/AF 配置代码 |
| 通信方式 | 软件 IIC / 硬件 I2C1 | 代码结构完全不同 |
| 总线地址 | 0x78 | IIC 从机地址错一位就全盘失败 |
| 时钟频率 | HSE 8MHz × 9 = 72MHz | 延时/波特率计算的基础 |

**规划中的改进**（尚未实现，欢迎贡献）：

- [ ] 悬浮窗内置"硬件档案"设置页：芯片/外设/引脚表格化填写，存本地 JSON，每次对话自动注入
- [ ] 硬件预设库：仓库内置常见板卡档案（Blue Pill、Black Pill、Nucleo、树莓派 Pico…），下拉选择即用
- [ ] 官方文档搜索：填型号后自动检索厂商 datasheet/参考手册链接
- [ ] 用户自定义档案上传/分享：把自己调通的硬件档案 PR 进预设库

在新功能落地前，**最有效的做法**：把上面清单里的信息直接发给悬浮窗（"我的板子是 XXX，外设是 XXX，引脚是 XXX"），LLM 会记住并在本次会话里一直使用。

---

## 💾 记忆库与 Obsidian

### Obsidian 在本项目里的角色

**一句话：Obsidian 是"查看器"，不是"依赖"。**

- 本项目**不依赖 Obsidian 也能完整运行**——对话记录本质是一堆遵守 Markdown 规范的 `.md` 文件，由悬浮窗自动写入
- 装了 Obsidian 的好处：把 `VAULT_ROOT` 指向的文件夹"作为库打开"后，你可以用它顺手地浏览/搜索/编辑这些自动生成的对话档案——双链、关系图谱、全文搜索都是现成的
- 每轮对话是标准 Markdown（`### HH:MM · 我/Code Tutor` 分节），任何 Markdown 编辑器（VS Code、Typora…）都能打开

```
VAULT_ROOT/                      ← 在 Obsidian 里"打开文件夹为库"
├── 00-索引.md                    ← 父库索引：任务 | 子库位置 | 最近活跃 | 说明
├── 任务-default/对话记录/*.md     ← 每个任务一个子库，每天一个文件
├── 任务-iic/对话记录/*.md
└── 任务-spi/对话记录/*.md
```

### 能用 SQL 数据库代替吗？

**可以，而且很适合**。当前的存储设计（Markdown 文件 + 目录分库）是面向"人用 Obsidian 阅读"优化的；如果不需要这个阅读体验，换成 SQLite 反而更干净。对应关系：

| 现在（Markdown） | SQLite 替代 |
|---|---|
| `任务-<名>/对话记录/YYYY-MM-DD.md` | `messages` 表（`id, task, day, time, who, text`） |
| `00-索引.md` 父库索引 | `tasks` 表（`name, last_active, note`） |
| `.resume.json` 跳转预载 | `resume_queue` 表或内存 |
| 历史面板读文件 | `SELECT ... WHERE task=? AND day=?` |
| 跨任务搬移（剪切小节） | `UPDATE messages SET task=? WHERE id=?`（比文本切割可靠得多） |
| 任务自动分类 | 不变（分类逻辑在上层，与存储无关） |

**SQLite 的实际优势**：
- 跨任务搬移从"正则切 Markdown 小节"变成一条 `UPDATE`，彻底消除边界 bug
- 历史检索可以按任务/日期/关键词任意组合查询（文件版只能全文搜索）
- 原子写入，多实例并发追加不会交错

**代价**：
- 失去"用 Obsidian 直接浏览"的体验（可以导出 Markdown 视图弥补）
- 需要引入 `better-sqlite3`（原生模块，Electron 下要 `electron-rebuild`）或用纯 JS 的 `sql.js`

**实现路径（如果要做）**：存储层已经收敛在 `main.js` 的 `memAppend / memList / memRead / moveToTask / taskList / registerTask` 六个函数里，换成 SQLite 只需改这六个函数的实现，渲染层与协议不变。预计一个下午的工作量。

> 当前版本刻意保持 Markdown 存储——先验证交互与分类逻辑，存储替换留作独立迭代。欢迎 PR。

---

## 🧩 架构

```
┌─────────────────┐  HTTP :19290   ┌──────────────────────┐
│  悬浮窗 (Electron)│ ─────────────→ │  main.js 控制服务      │
│  index.html      │  /chat         │  · /chat 转发 LLM     │
│  preload.js      │  /memory/*     │  · /memory/* 记忆库    │
│                  │  /build        │  · /build Keil 编译    │
└─────────────────┘                │  · /launch 多开        │
                                   └──────────┬───────────┘
              ↑ 文件读写（白名单）              │ /chat /classify
     ┌────────┴─────────┐            ┌─────────▼──────────┐
     │ 你的 Keil 工程     │            │ DSH 桥接插件 (19387) │
     │ Obsidian 记忆库    │            │ → ctx.llm (DSH 路由) │
     └──────────────────┘            └────────────────────┘
```

- 悬浮窗是多实例的：每个任务一个进程，控制端口独立，userData 独立（`code-tutor-<task>`）
- 记忆库按任务分库，父库索引自动维护
- 分类走"关键词快筛 → LLM 兜底"，LLM 不可用时静默回落当前任务（不丢数据）

---

## 🔒 隐私与安全

- 悬浮窗与 LLM 后端都在**本机**通信（`127.0.0.1`），对话内容只发给你配置的 LLM 提供方
- 文件读取有**白名单**（`READABLE_ROOTS`），不在名单内的路径一律拒绝
- Markdown 渲染**先整体 HTML 转义再解析**，LLM 输出无法注入脚本
- `html` 图示块渲染在 `sandbox` iframe 里，与主页面隔离
- 本仓库**不含任何 API Key / 凭据**；LLM 路由配置在 DSH profile（本机 `~/.dsh/profiles/`），请勿把含密钥的配置提交进来

---

## 🛠️ 开发

```powershell
# 语法检查
node --check code-tutor/main.js
node --check code-tutor/preload.js

# 修改桥接插件后重新打包安装（需重启 DSH 生效）
cd dsh-code-tutor-bridge
.\install.ps1
```

### 已知坑（改代码前先看）

- **`ELECTRON_RUN_AS_NODE`**：从 DSH 等宿主环境 spawn electron 必须清掉它，否则子进程变纯 Node 模式
- **Windows spawn 引号**：node 侧拼多参数 electron 命令行容易引号错乱，项目用 `_launch_task.bat` 壳兜底
- **端口探测**：找空闲端口用 `net.connect`（连得上=被占），不要用"自建 listen 再 close"（有回调竞争，会残留 LISTEN 占端口）
- **max-tokens 截断**：流式 LLM 调用要区分 finish 原因，`max-tokens` 是"部分成功"不是"失败"
- **无框窗拖动 vs 缩放**：窗口移动用 `-webkit-app-region: drag`（系统级），别手写 `setPosition`——会和边缘缩放热区打架
- **PowerShell 写 UTF-8**：PS5 的 `Set-Content -Encoding UTF8` 带 BOM，会让 JSON 校验失败；用 `[System.IO.File]::WriteAllText` + `UTF8Encoding($false)`

---

## 🗺️ Roadmap

- [ ] 硬件档案设置页（表格化填写芯片/外设/引脚，自动注入 prompt）
- [ ] 常见板卡硬件预设库 + 官方文档搜索
- [ ] 存储层可选 SQLite（见「记忆库与 Obsidian」）
- [ ] 悬浮窗内接任意 OpenAI 兼容 API 的设置界面
- [ ] 检验代码支持 IAR / STM32CubeIDE / gcc-arm（当前仅 Keil）

---

## 📝 版本史

| 版本 | 亮点 |
|---|---|
| v0.1-0.3 | 独立悬浮窗骨架、对话接入、检验/给码按钮 |
| v0.4 | 行动型 agent：真实读文件 + UV4 命令行编译检验 |
| v0.5 | Markdown 渲染、窗口可缩放、Obsidian 记忆库 + 历史面板 |
| v0.6 | 历史可续聊（载入上下文接着聊） |
| v0.7 | 多任务多开、任务子库、父库索引、跨任务历史 |
| v0.8 | 标题栏 ＋ 按钮一键开新任务窗口 |
| v0.9 | 历史面板跨任务直接跳转（预载上下文） |
| v1.0 | 自动任务分类（对话自动归入对应任务子库）、元信息不入库 |

---

## 🤝 贡献

欢迎 PR，尤其是：
- **硬件预设档案**（`hw-presets/` 目录，一份 JSON 一个板卡）
- 存储层 SQLite 化
- 非 Keil 工具链的编译检验适配

## 📄 许可

MIT
