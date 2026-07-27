import { Ollama, type Message, type Tool, type ToolCall } from "ollama";
import type { LlmToolDefinition } from "../packages/domain/src";

export interface ModelMessage {
  content: string;
  toolCalls: ToolCall[];
}

export interface ModelChatRequest {
  model: string;
  messages: Message[];
  tools?: LlmToolDefinition[];
  format?: string | Record<string, unknown>;
  think?: boolean | "high" | "medium" | "low";
  options?: {
    num_ctx?: number;
    temperature?: number;
    top_p?: number;
    top_k?: number;
  };
}

export interface ModelHealth {
  connected: boolean;
  version?: string;
  installedModels: string[];
  error?: string;
}

export interface ModelClient {
  streamChat(
    request: ModelChatRequest,
    signal: AbortSignal,
  ): AsyncIterable<ModelMessage>;
  completeChat(
    request: ModelChatRequest,
    signal: AbortSignal,
  ): Promise<ModelMessage>;
  health(): Promise<ModelHealth>;
}

export class OllamaModelClient implements ModelClient {
  private readonly client: Ollama;

  constructor(private readonly host: string) {
    this.client = new Ollama({ host });
  }

  async *streamChat(
    request: ModelChatRequest,
    signal: AbortSignal,
  ): AsyncIterable<ModelMessage> {
    const stream = await this.client.chat({
      ...request,
      tools: request.tools as Tool[] | undefined,
      stream: true,
    });
    const abort = () => {
      queueMicrotask(() => {
        try {
          stream.abort();
        } catch {
          // The stream may already have ended between cancellation and abort.
        }
      });
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      for await (const chunk of stream) {
        if (signal.aborted) {
          throw new DOMException("The Run was cancelled.", "AbortError");
        }
        yield {
          content: chunk.message.content ?? "",
          toolCalls: chunk.message.tool_calls ?? [],
        };
      }
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }

  async completeChat(
    request: ModelChatRequest,
    signal: AbortSignal,
  ): Promise<ModelMessage> {
    if (signal.aborted) {
      throw new DOMException("The Run was cancelled.", "AbortError");
    }
    const abort = () => {
      queueMicrotask(() => {
        try {
          this.client.abort();
        } catch {
          // The request may already have ended between cancellation and abort.
        }
      });
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      const response = await this.client.chat({
        ...request,
        tools: request.tools as Tool[] | undefined,
        stream: false,
      });
      return {
        content: response.message.content ?? "",
        toolCalls: response.message.tool_calls ?? [],
      };
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }

  async health(): Promise<ModelHealth> {
    try {
      const [version, models] = await Promise.all([
        this.client.version(),
        this.client.list(),
      ]);
      return {
        connected: true,
        version: version.version,
        installedModels: models.models.map((model) => model.name),
      };
    } catch (error) {
      return {
        connected: false,
        installedModels: [],
        error: error instanceof Error ? error.message : "Unknown Ollama error",
      };
    }
  }
}
