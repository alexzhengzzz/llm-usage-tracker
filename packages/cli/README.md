# LLM Usage Tracker / 大模型调用监控器

*👉 [Click here for the English Version](#english-version)*

一个用于追踪、记录和分析大语言模型 (LLM) API 调用的独立代理与监控服务。

## 功能特性

- **流量记录**: 自动拦截并记录所有的 LLM API 请求（支持流式响应与完整上下文抓取）
- **使用量统计**: 全面的可视化仪表盘，展示 Token 消耗、延迟和性能数据
- **Codex 用量导入**: 自动读取本机 Codex IDE/CLI 会话日志，按任务回合统计 Token，并可查看原始提示词
- **透明代理**: 轻松转发请求到任何支持 OpenAI 格式的后端或路由层（如 Claude Code Router）
- **动态厂商映射**: 独创读时转换引擎，支持通过 `providers.json` 热重载厂商归属，或使用 OpenRouter 风格前缀（如 `aliyun/glm-5`）强制路由
- **REST API**: 提供完整的聚合查询接口
- **Web UI**: 基于 React 构建的赛博朋克风/暗黑美学实时监控大屏

## 安装

```bash
npm install -g llm-usage-tracker
# 或者使用 pnpm
pnpm install -g llm-usage-tracker
```

## 使用方法

### 启动服务

```bash
# 使用默认配置启动
lut start

# 代理到指定的上游 API
lut start --target http://127.0.0.1:3456

# 自定义端口和主机
lut start --port 3457 --host 127.0.0.1
```

### 查看面板与统计

**网页端监控面板**
启动服务后，使用浏览器访问代理端口（默认 `http://127.0.0.1:3457`）即可查看可视化 UI。

**命令行快速查看**
```bash
# 查看过去 7 天的统计
lut stats

# 查看过去 30 天的统计
lut stats --days 30
```

## 核心 API 接口

- `GET /api/usage` - 获取请求记录明细
- `GET /api/usage/summary` - 获取聚合统计数据
- `GET /api/usage/daily` - 获取每日总计
- `GET /api/usage/hourly` - 获取小时级趋势
- `GET /api/usage/performance` - 获取性能分析指标
- `GET /api/usage/filters` - 获取可用的厂商和模型列表
- `GET /api/usage/export` - 导出为 CSV/JSON
- `POST /api/usage/cleanup` - 清理历史日志

## 配置与数据

系统所有的数据和配置默认存放在 `~/.llm-usage-tracker/` 目录下：
- `usage/` - 每日生成的 JSONL 请求日志文件
- `config.json` - 全局服务配置文件。您可以将项目根目录的 `config.example.json` 复制为 `~/.llm-usage-tracker/config.json`，在其中填写全局的上游 LLM 地址 (`target`) 和 API 密钥 (`apiKey`)，这样启动时就无需每次输入长命令。
- `providers.json` - 厂商到模型的映射配置文件（修改即时生效，影响所有历史数据呈现）
- `codex-import-state.json` - Codex 会话日志导入游标，防止服务重启时重复统计

### Codex 本地日志导入

- 服务启动时同步一次，之后每 5 秒增量扫描一次 `~/.codex/sessions/`；可通过 `config.json` 的 `codexSessionsDir` 指定自定义目录。
- 一条记录对应一个已完成的 Codex 任务回合；内部模型调用与工具过程的 Token 会合并到该任务中。
- 点击 Codex 记录可按需从原始会话日志查看用户提示词。提示词不会复制到 `usage/`，也不会经代理上传。
- TTFT 和总时长属于任务级指标，可能包含推理、工具执行和用户等待；Codex 的输出时长与速度不应视为模型原始 token/s。
- `codex-auto-review` 是 Codex 内部只读 guardian 审查子代理产生的用量，可按模型筛选排除。

---

<a id="english-version"></a>
## English Version

A standalone proxy service and dashboard for tracking, logging, and analyzing LLM API usage.

## Features

- **Traffic Recording**: Automatically intercepts and records all LLM API requests (supports streaming and full payload capture).
- **Usage Statistics**: Comprehensive dashboard showing token usage, latency, cache hits, and performance.
- **Codex Usage Import**: Reads local Codex IDE/CLI session logs, aggregates usage by completed task turn, and can show the original user prompt.
- **Transparent Proxy**: Forwards requests to any OpenAI-compatible API endpoint or router (e.g., Claude Code Router).
- **Dynamic Provider Mapping**: Read-time conversion engine powered by `providers.json` for hot-reloading provider assignments, plus OpenRouter-style explicit routing (`provider/model`).
- **REST API**: Full API for querying and aggregating usage data.
- **Web UI**: React-based beautiful dark-mode dashboard for real-time visualization.

## Installation

```bash
npm install -g llm-usage-tracker
```

Or use pnpm:

```bash
pnpm install -g llm-usage-tracker
```

## Usage

### Start Server

```bash
# Start with default settings
lut start

# Start with proxy to specific target
lut start --target http://127.0.0.1:3456

# Custom port and host
lut start --port 3457 --host 127.0.0.1
```

### View Statistics

**Web Dashboard**
Access the web UI at the proxy port (e.g. `http://127.0.0.1:3457`) after starting the server.

**CLI Viewer**
```bash
# Show last 7 days
lut stats

# Show last 30 days
lut stats --days 30
```

## API Endpoints

- `GET /api/usage` - List usage records
- `GET /api/usage/summary` - Aggregated statistics
- `GET /api/usage/daily` - Daily totals
- `GET /api/usage/hourly` - Hourly breakdown
- `GET /api/usage/performance` - Performance metrics
- `GET /api/usage/filters` - Available providers/models
- `GET /api/usage/export` - Export as CSV/JSON
- `POST /api/usage/cleanup` - Delete old records

## Configuration

Data is stored in `~/.llm-usage-tracker/`:
- `usage/` - Daily JSONL log files
- `config.json` - Global server configuration (persist `target` upstream and `apiKey` without passing them via CLI)
- `providers.json` - Provider configuration mapping (Hot-reloaded, applies retroactively to all history)
- `codex-import-state.json` - Per-file Codex session import cursor used to prevent duplicates after restart

### Codex Local Session Import

- Sessions are synchronized at startup and scanned incrementally every five seconds. By default the reader uses `~/.codex/sessions/`; configure `codexSessionsDir` for a custom location.
- One record represents one completed Codex task turn, aggregating usage from its internal model and tool steps.
- Opening a Codex record reads its user prompt on demand from the original local session file. Prompts are not copied into `usage/` and are never sent through the proxy.
- TTFT and duration are task-level values that can include reasoning, tool execution, and user wait time; Codex output duration and speed are not raw model token/s measurements.
- `codex-auto-review` is usage produced by Codex's internal read-only guardian review subagent and can be filtered separately by model.

## License

MIT
