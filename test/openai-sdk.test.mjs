import test from "node:test";
import assert from "node:assert/strict";
import OpenAI from "openai";

const { startServer } = await import("../dist/server.js");

const port = 18787;
const baseURL = `http://127.0.0.1:${port}/v1`;

let server;

test.before(async () => {
  server = await startServer(port, "mock-gpt-test");
});

test.after(async () => {
  await new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
});

function createClient() {
  return new OpenAI({
    apiKey: "mock-key",
    baseURL
  });
}

test("OpenAI SDK non-stream chat completion", async () => {
  const client = createClient();
  const completion = await client.chat.completions.create({
    model: "mock-gpt-test",
    stream: false,
    messages: [{ role: "user", content: "hello sdk" }]
  });

  assert.equal(completion.object, "chat.completion");
  assert.equal(completion.choices[0].finish_reason, "stop");
  assert.match(completion.choices[0].message.content ?? "", /Mock response: hello sdk/);
});

test("OpenAI SDK stream chat completion", async () => {
  const client = createClient();
  const stream = await client.chat.completions.create({
    model: "mock-gpt-test",
    stream: true,
    messages: [{ role: "user", content: "stream by sdk" }]
  });

  let content = "";
  for await (const chunk of stream) {
    content += chunk.choices[0]?.delta?.content ?? "";
  }

  assert.match(content, /Mock response: stream by sdk/);
});

test("OpenAI SDK tool call completion", async () => {
  const client = createClient();
  const completion = await client.chat.completions.create({
    model: "mock-gpt-test",
    stream: false,
    messages: [{ role: "user", content: "北京天气" }],
    tools: [
      {
        type: "function",
        function: {
          name: "get_weather",
          description: "查询天气",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string" }
            }
          }
        }
      }
    ],
    tool_choice: "auto"
  });

  const toolCall = completion.choices[0].message.tool_calls?.[0];
  assert.equal(completion.choices[0].finish_reason, "tool_calls");
  assert.equal(toolCall?.function.name, "get_weather");
  assert.match(toolCall?.function.arguments ?? "", /北京天气/);
});
