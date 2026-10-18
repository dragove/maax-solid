import { utilityProcess, type UtilityProcess } from "electron";
import { join } from "node:path";
import type { EngineCallback, EngineMessage, EngineRequest, InitResult } from "../shared/engine";

interface PendingRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
}

export interface CoreHostOptions {
  readonly coreRoot: string;
  readonly userDir: string;
  readonly resourceServer?: string;
  readonly onCallbacks: (items: ReadonlyArray<EngineCallback>) => void;
  readonly onLog: (level: string, message: string) => void;
  readonly onExit: (code: number | null, reason: string) => void;
}

export class CoreHostClient {
  private readonly child: UtilityProcess;
  private readonly pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private exited = false;

  constructor(private readonly options: CoreHostOptions) {
    const hostEntry = join(__dirname, "core-host.js");
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    );
    this.child = utilityProcess.fork(hostEntry, [], {
      serviceName: "Maax Core Host",
      stdio: "pipe",
      env,
    });

    this.child.stdout?.on("data", (data: Buffer) => {
      this.options.onLog("debug", data.toString().trimEnd());
    });
    this.child.stderr?.on("data", (data: Buffer) => {
      this.options.onLog("error", data.toString().trimEnd());
    });
    this.child.on("message", (message: EngineMessage) => this.onMessage(message));
    this.child.on("exit", (code) => {
      if (this.exited) return;
      this.exited = true;
      const reason = `MaaCore host exited with code ${code ?? "unknown"}`;
      this.rejectAll(new Error(reason));
      this.options.onExit(code, reason);
    });
  }

  async start(): Promise<InitResult> {
    const value = await this.request(
      {
        id: 0,
        op: "init",
        coreRoot: this.options.coreRoot,
        userDir: this.options.userDir,
        resourceServer: this.options.resourceServer,
      },
      120_000,
    );
    return value as InitResult;
  }

  request(request: EngineRequest, timeoutMs = 30_000): Promise<unknown> {
    if (this.exited) return Promise.reject(new Error("MaaCore host is not running"));
    const id = this.nextId++;
    const fullRequest = { ...request, id };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MaaCore host request timed out: ${request.op}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.child.postMessage(fullRequest);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  async stop(): Promise<void> {
    if (this.exited) return;
    try {
      await this.request({ id: 0, op: "shutdown" } as EngineRequest, 5_000);
    } catch {
      // The process may already be gone; kill below is authoritative.
    }
    if (!this.exited) {
      this.exited = true;
      this.child.kill();
    }
  }

  kill(): void {
    if (this.exited) return;
    this.exited = true;
    this.child.kill();
  }

  private onMessage(message: EngineMessage): void {
    if ("type" in message) {
      switch (message.type) {
        case "callbacks":
          this.options.onCallbacks(message.items);
          return;
        case "log":
          this.options.onLog(message.level, message.message);
          return;
        case "fatal":
          this.options.onLog("error", message.message);
          return;
      }
    }

    const response = message;
    const pending = this.pending.get(response.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(response.id);
    if (response.ok) {
      pending.resolve(response.value);
    } else {
      pending.reject(new Error(response.error?.message ?? "Unknown MaaCore host error"));
    }
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
