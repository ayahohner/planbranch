import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import {
  taskTreeSchema,
  type StartRunRequest,
} from "../packages/domain/src";
import type { ServerConfig } from "./config";
import type { ModelClient } from "./model";
import { RunManager } from "./run-manager";

const startRunSchema: z.ZodType<StartRunRequest> = z
  .object({
    action: z.enum(["populate", "decompose", "optimize", "collapse"]),
    tree: taskTreeSchema,
    targetTaskId: z.uuid(),
  })
  .strict();

export interface AppDependencies {
  config: ServerConfig;
  model: ModelClient;
  runManager?: RunManager;
}

export async function buildApp({
  config,
  model,
  runManager = new RunManager(model, config),
}: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cors, {
    origin: /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
    methods: ["GET", "HEAD", "POST", "DELETE", "OPTIONS"],
  });

  app.get("/api/health", async () => {
    const health = await model.health();
    return {
      ok:
        health.connected &&
        health.installedModels.some(
          (name) =>
            name === config.ollamaModel ||
            name.startsWith(`${config.ollamaModel}:`),
        ),
      ollama: {
        connected: health.connected,
        version: health.version,
        error: health.error,
      },
      model: {
        name: config.ollamaModel,
        installed: health.installedModels.some(
          (name) =>
            name === config.ollamaModel ||
            name.startsWith(`${config.ollamaModel}:`),
        ),
      },
      context: config.ollamaContext,
    };
  });

  app.post("/api/runs", async (request, reply) => {
    const parsed = startRunSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid Run request.",
        issues: parsed.error.issues,
      });
    }
    try {
      const run = runManager.start(parsed.data);
      return reply.status(202).send({ runId: run.id });
    } catch (error) {
      return reply.status(400).send({
        error: error instanceof Error ? error.message : "Invalid Run request.",
      });
    }
  });

  app.get<{ Params: { runId: string } }>(
    "/api/runs/:runId/events",
    async (request, reply) => {
      const run = runManager.getManaged(request.params.runId);
      if (!run) {
        return reply.status(404).send({ error: "Run not found." });
      }

      const lastEventId = Number(request.headers["last-event-id"] ?? 0);
      reply.hijack();
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      reply.raw.write("retry: 1000\n\n");

      let unsubscribe = () => {};
      const send = (event: ReturnType<typeof run.emit>) => {
        if (reply.raw.destroyed) return;
        reply.raw.write(`id: ${event.sequence}\n`);
        reply.raw.write(`event: ${event.type}\n`);
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
        if (
          event.type === "run.completed" ||
          event.type === "run.failed" ||
          event.type === "run.cancelled"
        ) {
          unsubscribe();
          reply.raw.end();
        }
      };

      unsubscribe = run.subscribe(
        Number.isFinite(lastEventId) ? lastEventId : 0,
        send,
      );
      if (run.state !== "running" && !reply.raw.writableEnded) {
        reply.raw.end();
      }
      request.raw.on("close", unsubscribe);
    },
  );

  app.delete<{ Params: { runId: string } }>(
    "/api/runs/:runId",
    async (request, reply) => {
      const run = runManager.get(request.params.runId);
      if (!run || run.state !== "running") {
        return reply
          .status(404)
          .send({ error: "No active Run was found." });
      }
      reply.status(202).send({ cancelled: true });
      setTimeout(() => runManager.cancel(request.params.runId), 0);
      return reply;
    },
  );

  return app;
}
