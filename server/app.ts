import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import {
  taskTreeSchema,
  type ModelOption,
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
    model: z.string().trim().min(1).max(200).optional(),
    reasoningEffort: z.string().trim().min(1).max(50).optional(),
  })
  .strict();
const localWebOrigin = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

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
  let latestModels: ModelOption[] = [];
  await app.register(cors, {
    origin: localWebOrigin,
    methods: ["GET", "HEAD", "POST", "DELETE", "OPTIONS"],
  });

  app.get("/api/health", async () => {
    const health = await model.health();
    latestModels = health.models;
    const selectedModel =
      latestModels.find((option) => option.model === config.modelName) ??
      latestModels.find((option) => option.isDefault) ??
      latestModels[0];
    const supportedEfforts = selectedModel?.supportedReasoningEfforts ?? [];
    const selectedEffort = supportedEfforts.some(
      (option) => option.reasoningEffort === config.modelReasoningEffort,
    )
      ? config.modelReasoningEffort
      : selectedModel?.defaultReasoningEffort ??
        supportedEfforts[0]?.reasoningEffort ??
        config.modelReasoningEffort;
    const available = Boolean(selectedModel);
    const authReady =
      health.authenticated &&
      (config.modelAuthMode === "any" ||
        health.authenticationMode === config.modelAuthMode);
    return {
      ok: health.connected && authReady && available,
      runtime: {
        id: config.modelRuntime,
        name: health.runtime,
        connected: health.connected,
        version: health.version,
        error: health.error,
      },
      provider: {
        name: health.provider || config.modelProvider,
        authenticated: authReady,
        authentication: health.authentication,
        authenticationMode: health.authenticationMode,
        requiredAuthenticationMode: config.modelAuthMode,
        error:
          health.authenticated && !authReady
            ? `This runtime requires ${config.modelAuthMode} authentication; the active login uses ${health.authenticationMode ?? "an unknown method"}.`
            : undefined,
      },
      model: {
        name: selectedModel?.model ?? config.modelName,
        available,
        reasoningEffort: selectedEffort,
      },
      models: latestModels,
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
      let runRequest = parsed.data;
      if (parsed.data.model) {
        if (latestModels.length === 0) {
          latestModels = (await model.health()).models;
        }
        const selectedModel = latestModels.find(
          (option) => option.model === parsed.data.model,
        );
        if (!selectedModel) {
          return reply.status(400).send({
            error: `Model ${parsed.data.model} is not available from the Codex runtime.`,
          });
        }
        const supportedEfforts = selectedModel.supportedReasoningEfforts;
        if (
          parsed.data.reasoningEffort &&
          supportedEfforts.length > 0 &&
          !supportedEfforts.some(
            (option) =>
              option.reasoningEffort === parsed.data.reasoningEffort,
          )
        ) {
          return reply.status(400).send({
            error: `${parsed.data.reasoningEffort} reasoning is not supported by ${selectedModel.displayName}.`,
          });
        }
        runRequest = {
          ...parsed.data,
          reasoningEffort:
            parsed.data.reasoningEffort ??
            selectedModel.defaultReasoningEffort ??
            supportedEfforts[0]?.reasoningEffort,
        };
      }
      const run = runManager.start(runRequest);
      return reply.status(202).send({ runId: run.id });
    } catch (error) {
      return reply.status(400).send({
        error: error instanceof Error ? error.message : "Invalid Run request.",
      });
    }
  });

  app.get<{ Params: { runId: string } }>(
    "/api/runs/:runId",
    async (request, reply) => {
      const run = runManager.get(request.params.runId);
      if (!run) {
        return reply.status(404).send({ error: "Run not found." });
      }
      return run;
    },
  );

  app.get<{ Params: { runId: string } }>(
    "/api/runs/:runId/events",
    async (request, reply) => {
      const run = runManager.getManaged(request.params.runId);
      if (!run) {
        return reply.status(404).send({ error: "Run not found." });
      }

      const lastEventId = Number(request.headers["last-event-id"] ?? 0);
      const origin = request.headers.origin;
      const corsHeaders =
        typeof origin === "string" && localWebOrigin.test(origin)
          ? {
              "Access-Control-Allow-Origin": origin,
              Vary: "Origin",
            }
          : {};
      reply.hijack();
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
        ...corsHeaders,
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
