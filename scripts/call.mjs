#!/usr/bin/env node
// Call one or more tools on the built server from the command line, e.g.
//   node scripts/call.mjs carmax_search_inventory '{"make":"Audi","model":"A4","zip":"23452"}'
//   node scripts/call.mjs --list
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const server = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.js");
const transport = new StdioClientTransport({ command: process.execPath, args: [server], env: process.env, stderr: "ignore" });
const client = new Client({ name: "call", version: "1" });
await client.connect(transport);

const args = process.argv.slice(2);
if (args[0] === "--list" || args.length === 0) {
  const { tools } = await client.listTools();
  for (const t of tools) console.log(`${t.name}\n  ${t.description}\n  args: ${Object.keys(t.inputSchema.properties ?? {}).join(", ")}\n`);
} else {
  for (let i = 0; i < args.length; i += 2) {
    const result = await client.callTool({ name: args[i], arguments: JSON.parse(args[i + 1] ?? "{}") }, undefined, { timeout: 240000 });
    console.log(`--- ${args[i]}${result.isError ? " (error)" : ""}\n${result.content.map((c) => c.text).join("\n")}\n`);
  }
}
await client.close();
