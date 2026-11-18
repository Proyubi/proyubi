import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { PmApiClient, buildServer } from "../dist/core.js";

// No HTTP listener: exercise the protocol and HTTP payload with a stub fetch.
test("pm_list_projects returns parentId and preserves legacy results", { timeout: 10000 }, async (t) => {
  const parentId = "11111111-1111-4111-8111-111111111111";
  const data = [
    // 旧 API（parentId なし）の結果もそのまま返す
    { id: parentId, name: "Legacy" },
    { id: "22222222-2222-4222-8222-222222222222", name: "Sub", parentId },
  ];
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url, ...init });
    return new Response(JSON.stringify({ code: 0, data }));
  });
  const api = new PmApiClient({ baseUrl: "http://mock.invalid", apiKey: "test" }, "tenant");
  const server = buildServer(api);
  const client = new Client({ name: "projects-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const { tools } = await client.listTools();
    assert.ok(!tools.some((tool) => tool.name === "pm_create_project"));
    const list = await client.callTool({ name: "pm_list_projects", arguments: {} });
    assert.ok(!list.isError, list.content[0].text);
    assert.deepEqual(JSON.parse(list.content[0].text), data);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, "GET");
    assert.equal(calls[0].url, "http://mock.invalid/internal/pm/projects");
  } finally {
    await client.close();
    await server.close();
  }
});
