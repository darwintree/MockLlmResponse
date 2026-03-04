import crypto from "node:crypto";
import type { Server } from "node:http";
import { pathToFileURL } from "node:url";
import express from "express";

const DEFAULT_PORT = Number(process.env.PORT ?? 8787);
const DEFAULT_MODEL = process.env.MOCK_MODEL ?? "mock-gpt-4o-mini";

type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string;
  tool_call_id?: string;
  name?: string;
};

type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

type ChatCompletionRequest = {
  stream?: boolean;
  messages?: ChatMessage[];
  model?: string;
  tools?: ToolDefinition[];
  tool_choice?: "none" | "auto" | { type: "function"; function: { name: string } };
};

const nowInSeconds = () => Math.floor(Date.now() / 1000);
const randomId = (prefix: string) => `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;

function summarizeUserPrompt(messages: ChatMessage[] = []): string {
  const userMessages = messages
    .filter((message) => message.role === "user")
    .map((message) => message.content?.trim())
    .filter(Boolean);

  if (userMessages.length === 0) {
    return "Hello from mock LLM server.";
  }

  const latest = userMessages[userMessages.length - 1] as string;
  return `Mock response: ${latest}`;
}

function chooseToolCall(req: ChatCompletionRequest): { name: string; arguments: string } | null {
  const tools = req.tools ?? [];
  if (tools.length === 0 || req.tool_choice === "none") {
    return null;
  }

  const forcedName =
    typeof req.tool_choice === "object" && req.tool_choice.type === "function"
      ? req.tool_choice.function.name
      : undefined;

  const chosen = forcedName ? tools.find((tool) => tool.function.name === forcedName) : tools[0];

  if (!chosen) {
    return null;
  }

  const messages = req.messages ?? [];
  const lastUserMessage = [...messages].reverse().find((message: ChatMessage) => message.role === "user");
  const userText = lastUserMessage?.content ?? "";

  return {
    name: chosen.function.name,
    arguments: JSON.stringify({
      query: userText,
      mocked: true
    })
  };
}

function buildNonStreamResponse(req: ChatCompletionRequest, model: string) {
  const id = randomId("chatcmpl");
  const created = nowInSeconds();
  const toolCall = chooseToolCall(req);

  const message = toolCall
    ? {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: randomId("call"),
            type: "function",
            function: {
              name: toolCall.name,
              arguments: toolCall.arguments
            }
          }
        ]
      }
    : {
        role: "assistant",
        content: summarizeUserPrompt(req.messages)
      };

  return {
    id,
    object: "chat.completion",
    created,
    model: req.model ?? model,
    choices: [
      {
        index: 0,
        message,
        finish_reason: toolCall ? "tool_calls" : "stop"
      }
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 12,
      total_tokens: 22
    }
  };
}

function sendSseChunk(res: express.Response, chunk: unknown) {
  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
}

function buildStreamChunks(req: ChatCompletionRequest, model: string) {
  const id = randomId("chatcmpl");
  const created = nowInSeconds();
  const outputModel = req.model ?? model;
  const toolCall = chooseToolCall(req);

  const chunks: unknown[] = [];

  chunks.push({
    id,
    object: "chat.completion.chunk",
    created,
    model: outputModel,
    choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }]
  });

  if (toolCall) {
    const callId = randomId("call");
    chunks.push({
      id,
      object: "chat.completion.chunk",
      created,
      model: outputModel,
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: callId,
                type: "function",
                function: { name: toolCall.name, arguments: "" }
              }
            ]
          },
          finish_reason: null
        }
      ]
    });

    chunks.push({
      id,
      object: "chat.completion.chunk",
      created,
      model: outputModel,
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                function: { arguments: toolCall.arguments }
              }
            ]
          },
          finish_reason: "tool_calls"
        }
      ]
    });

    return chunks;
  }

  const text = summarizeUserPrompt(req.messages);
  for (const token of text.split(" ")) {
    chunks.push({
      id,
      object: "chat.completion.chunk",
      created,
      model: outputModel,
      choices: [{ index: 0, delta: { content: `${token} ` }, finish_reason: null }]
    });
  }

  chunks.push({
    id,
    object: "chat.completion.chunk",
    created,
    model: outputModel,
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }]
  });

  return chunks;
}

export function createApp(model = DEFAULT_MODEL) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, model });
  });

  app.post("/v1/chat/completions", async (req, res) => {
    const body = (req.body ?? {}) as ChatCompletionRequest;

    if (!Array.isArray(body.messages)) {
      res.status(400).json({ error: "messages must be an array" });
      return;
    }

    if (!body.stream) {
      res.json(buildNonStreamResponse(body, model));
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const chunks = buildStreamChunks(body, model);

    for (const chunk of chunks) {
      sendSseChunk(res, chunk);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    res.write("data: [DONE]\n\n");
    res.end();
  });

  return app;
}

export function startServer(port = DEFAULT_PORT, model = DEFAULT_MODEL): Promise<Server> {
  const app = createApp(model);
  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      // eslint-disable-next-line no-console
      console.log(`Mock LLM server listening at http://localhost:${port}`);
      resolve(server);
    });
  });
}

const entryFilePath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (entryFilePath && import.meta.url === entryFilePath) {
  void startServer();
}
