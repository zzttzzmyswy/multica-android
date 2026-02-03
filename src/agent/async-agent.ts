import { v7 as uuidv7 } from "uuid";
import type { AgentEvent } from "@mariozechner/pi-agent-core";
import { Agent } from "./runner.js";
import { Channel } from "./channel.js";
import type { AgentOptions, Message } from "./types.js";

const devNull = { write: () => true } as NodeJS.WritableStream;

/** Discriminated union of legacy Message (error fallback) and raw AgentEvent */
export type ChannelItem = Message | AgentEvent;

export class AsyncAgent {
  private readonly agent: Agent;
  private readonly channel = new Channel<ChannelItem>();
  private _closed = false;
  private queue: Promise<void> = Promise.resolve();
  readonly sessionId: string;

  constructor(options?: AgentOptions) {
    this.agent = new Agent({
      ...options,
      logger: { stdout: devNull, stderr: devNull },
    });
    this.sessionId = this.agent.sessionId;

    // Forward raw AgentEvent into the channel
    this.agent.subscribe((event: AgentEvent) => {
      this.channel.send(event);
    });
  }

  get closed(): boolean {
    return this._closed;
  }

  /** Write message to agent (non-blocking, serialized queue) */
  write(content: string): void {
    if (this._closed) throw new Error("Agent is closed");

    this.queue = this.queue
      .then(async () => {
        if (this._closed) return;
        const result = await this.agent.run(content);
        // Normal text is delivered via message_end event; only handle errors here
        if (result.error) {
          this.channel.send({ id: uuidv7(), content: `[error] ${result.error}` });
        }
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        this.channel.send({ id: uuidv7(), content: `[error] ${message}` });
      });
  }

  /** Continuously read channel stream (AgentEvent + error Messages) */
  read(): AsyncIterable<ChannelItem> {
    return this.channel;
  }

  /** Close agent, stop all reads */
  close(): void {
    if (this._closed) return;
    this._closed = true;
    this.channel.close();
  }
}
