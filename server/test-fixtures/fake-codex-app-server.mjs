#!/usr/bin/env node

import { createInterface } from "node:readline";

const mode = process.env.TASK_TREE_FAKE_CODEX_MODE ?? "exit-after-turn-start";
const input = createInterface({ input: process.stdin });

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

input.on("line", (line) => {
  const message = JSON.parse(line);
  switch (message.method) {
    case "initialize":
      send({ id: message.id, result: { userAgent: "fake-codex" } });
      break;
    case "thread/start":
      send({
        id: message.id,
        result: { thread: { id: "fake-thread" } },
      });
      break;
    case "turn/start":
      send({ id: message.id, result: { turn: { id: "fake-turn" } } });
      send({
        method: "turn/started",
        params: { turn: { id: "fake-turn" } },
      });
      if (mode === "exit-after-turn-start") {
        setTimeout(() => process.exit(42), 10);
      }
      break;
    case "turn/interrupt":
      if (mode !== "ignore-interrupt") {
        send({ id: message.id, result: {} });
      }
      break;
  }
});
