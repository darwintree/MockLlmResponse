# Mock LLM Response Server

一个使用 **pnpm + TypeScript + Express** 构建的 mock LLM 服务，兼容 OpenAI Chat Completions 的核心调用方式。

## 功能

- `POST /v1/chat/completions`
  - 非流式返回（`stream: false`）
  - 流式 SSE 返回（`stream: true`）
- 支持 `tools` 与 `tool_choice`，可返回 `tool_calls`
- 健康检查接口：`GET /health`

## 安装

```bash
pnpm install
```

## 运行

```bash
pnpm dev
```

默认端口 `8787`，可通过环境变量配置：

```bash
PORT=3000 pnpm dev
```

## 构建和启动

```bash
pnpm build
pnpm start
```

## 测试（OpenAI SDK）

项目新增了基于 `openai` 官方 SDK 的集成测试，覆盖：

- 非流式 chat completion
- 流式 chat completion
- tool call 返回

运行：

```bash
pnpm test
```

## 请求示例

### 1) 非流式普通文本

```bash
curl -s http://localhost:8787/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "mock-gpt-4o-mini",
    "messages": [{"role":"user","content":"你好，介绍一下你自己"}],
    "stream": false
  }' | jq
```

### 2) 流式普通文本

```bash
curl -N http://localhost:8787/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "messages": [{"role":"user","content":"请流式回复"}],
    "stream": true
  }'
```

### 3) Tool Call（非流式）

```bash
curl -s http://localhost:8787/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "messages": [{"role":"user","content":"帮我查下北京天气"}],
    "stream": false,
    "tools": [{
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "查询天气",
        "parameters": {
          "type": "object",
          "properties": {
            "query": {"type": "string"}
          }
        }
      }
    }],
    "tool_choice": "auto"
  }' | jq
```

### 4) Tool Call（流式）

```bash
curl -N http://localhost:8787/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "messages": [{"role":"user","content":"帮我查下北京天气"}],
    "stream": true,
    "tools": [{
      "type": "function",
      "function": {"name": "get_weather"}
    }]
  }'
```
