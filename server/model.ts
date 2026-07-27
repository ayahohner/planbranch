import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type { LlmToolDefinition } from "../packages/domain/src";

export interface ToolCall {
  id?: string;
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: ToolCall[];
  tool_name?: string;
}

export interface ModelMessage {
  content: string;
  toolCalls: ToolCall[];
}

export interface ModelChatRequest {
  model: string;
  messages: Message[];
  tools?: LlmToolDefinition[];
  format?: string | Record<string, unknown>;
  reasoningEffort?: string;
}

export interface ModelHealth {
  connected: boolean;
  authenticated: boolean;
  authenticationMode?: "chatgpt" | "api-key" | "managed";
  runtime: string;
  provider: string;
  authentication?: string;
  version?: string;
  availableModels: string[];
  error?: string;
}

export type ModelToolHandler = (
  call: ToolCall,
) => Promise<Record<string, unknown>> | Record<string, unknown>;

export interface ModelClient {
  runChat(
    request: ModelChatRequest,
    signal: AbortSignal,
    onToolCall?: ModelToolHandler,
  ): Promise<ModelMessage>;
  completeChat(
    request: ModelChatRequest,
    signal: AbortSignal,
  ): Promise<ModelMessage>;
  health(): Promise<ModelHealth>;
}

interface RpcMessage {
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
  };
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

type NotificationHandler = (message: RpcMessage) => void;
type ServerRequestHandler = (message: RpcMessage) => void;
type FailureHandler = (error: Error) => void;

class CodexConnection {
  private readonly process: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly notificationHandlers = new Set<NotificationHandler>();
  private readonly serverRequestHandlers = new Set<ServerRequestHandler>();
  private readonly failureHandlers = new Set<FailureHandler>();
  private readonly stderr: string[] = [];
  private nextId = 1;
  private closed = false;
  private failure: Error | undefined;

  private constructor(
    command: string,
    cwd: string,
  ) {
    this.process = spawn(command, ["app-server", "--listen", "stdio://"], {
      cwd,
      env: {
        ...process.env,
        RUST_LOG: process.env.RUST_LOG ?? "error",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    createInterface({ input: this.process.stdout }).on("line", (line) => {
      let message: RpcMessage;
      try {
        message = JSON.parse(line) as RpcMessage;
      } catch {
        return;
      }

      if (message.method && message.id !== undefined) {
        this.serverRequestHandlers.forEach((handler) => handler(message));
        return;
      }

      if (typeof message.id === "number") {
        const request = this.pending.get(message.id);
        if (!request) return;
        this.pending.delete(message.id);
        if (message.error) {
          request.reject(
            new Error(message.error.message ?? "Codex app-server request failed."),
          );
        } else {
          request.resolve(message.result);
        }
        return;
      }

      if (message.method) {
        this.notificationHandlers.forEach((handler) => handler(message));
      }
    });

    this.process.stderr.setEncoding("utf8");
    this.process.stderr.on("data", (chunk: string) => {
      this.stderr.push(chunk);
      if (this.stderr.join("").length > 8_000) this.stderr.shift();
    });

    const fail = (error: Error) => {
      if (this.closed || this.failure) return;
      const detail = this.stderr.join("").trim();
      const failure = detail ? new Error(`${error.message}\n${detail}`) : error;
      this.failure = failure;
      this.pending.forEach(({ reject }) => reject(failure));
      this.pending.clear();
      this.failureHandlers.forEach((handler) => handler(failure));
    };
    this.process.on("error", (error) => fail(error));
    this.process.on("exit", (code, signal) => {
      if (!this.closed) {
        fail(
          new Error(
            `Codex app-server exited unexpectedly (${signal ?? code ?? "unknown"}).`,
          ),
        );
      }
    });
  }

  static async start(
    command: string,
    cwd: string,
  ): Promise<{ connection: CodexConnection; userAgent: string }> {
    const connection = new CodexConnection(command, cwd);
    try {
      const initialized = (await connection.request("initialize", {
        clientInfo: {
          name: "task_tree",
          title: "Task Tree",
          version: "0.1.0",
        },
        capabilities: {
          experimentalApi: true,
        },
      })) as { userAgent?: string };
      connection.notify("initialized", {});
      return {
        connection,
        userAgent: initialized.userAgent ?? "Codex CLI",
      };
    } catch (error) {
      connection.close();
      throw error;
    }
  }

  request(method: string, params: unknown): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(new Error("Codex app-server is closed."));
    }
    if (this.failure) {
      return Promise.reject(this.failure);
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.write({ id, method, params });
    });
  }

  notify(method: string, params: unknown): void {
    if (!this.closed) this.write({ method, params });
  }

  respond(id: number | string, result: unknown): void {
    if (!this.closed) this.write({ id, result });
  }

  respondError(id: number | string, message: string): void {
    if (!this.closed) {
      this.write({ id, error: { code: -32_000, message } });
    }
  }

  onNotification(handler: NotificationHandler): () => void {
    this.notificationHandlers.add(handler);
    return () => this.notificationHandlers.delete(handler);
  }

  onServerRequest(handler: ServerRequestHandler): () => void {
    this.serverRequestHandlers.add(handler);
    return () => this.serverRequestHandlers.delete(handler);
  }

  onFailure(handler: FailureHandler): () => void {
    if (this.failure) {
      handler(this.failure);
      return () => {};
    }
    this.failureHandlers.add(handler);
    return () => this.failureHandlers.delete(handler);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.process.stdin.end();
    this.process.kill();
    const error = new Error("Codex app-server connection closed.");
    this.pending.forEach(({ reject }) => reject(error));
    this.pending.clear();
    this.failureHandlers.clear();
  }

  private write(message: unknown): void {
    if (!this.closed && !this.failure) {
      this.process.stdin.write(`${JSON.stringify(message)}\n`);
    }
  }
}

interface ThreadStartResult {
  thread?: {
    id?: string;
  };
}

interface TurnCompletedParams {
  threadId?: string;
  turn?: {
    id?: string;
    status?: string;
    error?: {
      message?: string;
    } | null;
  };
}

type TurnOutcome =
  | { type: "completed"; params: TurnCompletedParams }
  | { type: "failed"; error: Error }
  | { type: "aborted" };

interface AccountReadResult {
  account?:
    | { type: "chatgpt"; planType?: string }
    | { type: "apiKey" }
    | { type: "amazonBedrock" }
    | null;
  requiresOpenaiAuth?: boolean;
}

interface ModelListResult {
  data?: Array<{ model?: string }>;
}

function abortError(): DOMException {
  return new DOMException("The Run was cancelled.", "AbortError");
}

function serializeInput(messages: Message[]): string {
  return messages
    .filter((message) => message.role !== "system")
    .map((message) => {
      if (message.role === "tool") {
        return `<tool_result name="${message.tool_name ?? "unknown"}">\n${message.content}\n</tool_result>`;
      }
      return `<${message.role}>\n${message.content}\n</${message.role}>`;
    })
    .join("\n\n");
}

function systemInstructions(messages: Message[]): string {
  const supplied = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  return `${supplied}

This is a bounded planning session. Use only the supplied Task Tree tools.
Do not inspect files, run shell commands, browse, delegate, or use unrelated tools.
Tool results are authoritative. Correct rejected calls before continuing.
Call finish_run only after every intended mutation is accepted, then stop.`;
}

function titleCasePlan(planType: string | undefined): string {
  if (!planType) return "ChatGPT";
  return `ChatGPT ${planType
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")}`;
}

export class CodexAppServerClient implements ModelClient {
  constructor(
    private readonly command = "codex",
    private readonly cwd = process.cwd(),
  ) {}

  async runChat(
    request: ModelChatRequest,
    signal: AbortSignal,
    onToolCall?: ModelToolHandler,
  ): Promise<ModelMessage> {
    if (signal.aborted) throw abortError();
    const { connection } = await CodexConnection.start(this.command, this.cwd);
    const content: string[] = [];
    const toolCalls: ToolCall[] = [];
    let activeThreadId: string | undefined;
    let activeTurnId: string | undefined;
    let settleTurn!: (outcome: TurnOutcome) => void;
    const turnOutcome = new Promise<TurnOutcome>((resolve) => {
      settleTurn = resolve;
    });

    const removeNotification = connection.onNotification((message) => {
      if (message.method === "item/agentMessage/delta") {
        const delta = message.params?.delta;
        if (typeof delta === "string") content.push(delta);
      }
      if (message.method === "turn/started") {
        const turn = message.params?.turn as { id?: string } | undefined;
        activeTurnId = turn?.id;
      }
      if (message.method === "turn/completed") {
        settleTurn({
          type: "completed",
          params: message.params as TurnCompletedParams,
        });
      }
      if (message.method === "error" && message.params?.willRetry === false) {
        const error = message.params.error as { message?: string } | undefined;
        settleTurn({
          type: "failed",
          error: new Error(error?.message ?? "Codex model request failed."),
        });
      }
    });
    const removeFailure = connection.onFailure((error) => {
      settleTurn({ type: "failed", error });
    });

    const removeServerRequest = connection.onServerRequest((message) => {
      if (
        message.method !== "item/tool/call" ||
        message.id === undefined
      ) {
        if (message.id !== undefined) {
          connection.respondError(
            message.id,
            "Task Tree does not support this Codex server request.",
          );
        }
        return;
      }

      const params = message.params ?? {};
      const tool = params.tool;
      const args = params.arguments;
      if (
        typeof tool !== "string" ||
        !args ||
        typeof args !== "object" ||
        Array.isArray(args)
      ) {
        connection.respond(message.id, {
          contentItems: [
            {
              type: "inputText",
              text: JSON.stringify({
                ok: false,
                error: "The tool call arguments must be a JSON object.",
              }),
            },
          ],
          success: true,
        });
        return;
      }

      const call: ToolCall = {
        id: typeof params.callId === "string" ? params.callId : undefined,
        function: {
          name: tool,
          arguments: args as Record<string, unknown>,
        },
      };
      toolCalls.push(call);

      void Promise.resolve(
        onToolCall
          ? onToolCall(call)
          : { ok: false, error: "No Task Tree tool handler is available." },
      )
        .then((result) => {
          connection.respond(message.id!, {
            contentItems: [
              { type: "inputText", text: JSON.stringify(result) },
            ],
            success: true,
          });
        })
        .catch((error: unknown) => {
          const failure =
            error instanceof Error ? error : new Error("Task Tree tool failed.");
          connection.respond(message.id!, {
            contentItems: [
              {
                type: "inputText",
                text: JSON.stringify({
                  ok: false,
                  error: failure.message,
                }),
              },
            ],
            success: false,
          });
          if (activeThreadId && activeTurnId) {
            void connection.request("turn/interrupt", {
              threadId: activeThreadId,
              turnId: activeTurnId,
            }).catch(() => undefined);
          }
          settleTurn({ type: "failed", error: failure });
        });
    });

    const abort = () => {
      settleTurn({ type: "aborted" });
      if (activeThreadId && activeTurnId) {
        void connection.request("turn/interrupt", {
          threadId: activeThreadId,
          turnId: activeTurnId,
        }).catch(() => undefined);
      }
      connection.close();
    };
    signal.addEventListener("abort", abort, { once: true });

    try {
      const started = (await connection.request("thread/start", {
        model: request.model,
        cwd: this.cwd,
        approvalPolicy: "never",
        sandbox: "read-only",
        ephemeral: true,
        environments: [],
        selectedCapabilityRoots: [],
        baseInstructions: systemInstructions(request.messages),
        dynamicTools: request.tools?.map((tool) => ({
          type: "function",
          name: tool.function.name,
          description: tool.function.description,
          inputSchema: tool.function.parameters,
        })),
      })) as ThreadStartResult;
      activeThreadId = started.thread?.id;
      if (!activeThreadId) {
        throw new Error("Codex app-server did not return a thread ID.");
      }

      if (signal.aborted) throw abortError();
      const startedTurn = (await connection.request("turn/start", {
        threadId: activeThreadId,
        input: [
          {
            type: "text",
            text: serializeInput(request.messages),
            text_elements: [],
          },
        ],
        effort: request.reasoningEffort,
        outputSchema:
          request.format && typeof request.format === "object"
            ? request.format
            : undefined,
      })) as { turn?: { id?: string } };
      activeTurnId ??= startedTurn.turn?.id;

      const outcome = await turnOutcome;
      if (signal.aborted || outcome.type === "aborted") throw abortError();
      if (outcome.type === "failed") throw outcome.error;
      if (outcome.params.turn?.status !== "completed") {
        throw new Error(
          outcome.params.turn?.error?.message ??
            `Codex turn ended with status ${outcome.params.turn?.status ?? "unknown"}.`,
        );
      }
      return { content: content.join(""), toolCalls };
    } catch (error) {
      if (signal.aborted) throw abortError();
      throw error;
    } finally {
      signal.removeEventListener("abort", abort);
      removeNotification();
      removeServerRequest();
      removeFailure();
      connection.close();
    }
  }

  completeChat(
    request: ModelChatRequest,
    signal: AbortSignal,
  ): Promise<ModelMessage> {
    return this.runChat(request, signal);
  }

  async health(): Promise<ModelHealth> {
    let connection: CodexConnection | undefined;
    try {
      const started = await CodexConnection.start(this.command, this.cwd);
      connection = started.connection;
      const [accountResult, modelResult] = await Promise.all([
        connection.request("account/read", { refreshToken: false }),
        connection.request("model/list", {
          limit: 100,
          includeHidden: true,
        }),
      ]);
      const account = accountResult as AccountReadResult;
      const models = modelResult as ModelListResult;
      const authenticated = Boolean(account.account);
      const authenticationMode =
        account.account?.type === "chatgpt"
          ? "chatgpt"
          : account.account?.type === "apiKey"
            ? "api-key"
            : account.account?.type === "amazonBedrock"
              ? "managed"
              : undefined;
      const authentication =
        account.account?.type === "chatgpt"
          ? titleCasePlan(account.account.planType)
          : account.account?.type === "apiKey"
            ? "API key"
            : account.account?.type === "amazonBedrock"
              ? "Amazon Bedrock"
              : undefined;

      return {
        connected: true,
        authenticated,
        authenticationMode,
        runtime: "Codex CLI",
        provider: "OpenAI",
        authentication,
        version: started.userAgent,
        availableModels:
          models.data
            ?.map((model) => model.model)
            .filter((model): model is string => Boolean(model)) ?? [],
        error: authenticated
          ? undefined
          : "Codex CLI is not signed in. Run: codex login",
      };
    } catch (error) {
      return {
        connected: false,
        authenticated: false,
        runtime: "Codex CLI",
        provider: "OpenAI",
        availableModels: [],
        error:
          error instanceof Error
            ? error.message
            : "The Codex CLI runtime is unavailable.",
      };
    } finally {
      connection?.close();
    }
  }
}
