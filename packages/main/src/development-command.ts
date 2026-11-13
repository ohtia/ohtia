import { randomUUID } from "node:crypto";
import { writeSync } from "node:fs";
import { parseDevelopmentSwitches, type DevelopmentAction } from "@ohtia/contracts";
import type { ServiceSupervisor } from "./service-supervisor.js";

/** Loaded only by the unpackaged development build; terminal output is never a diagnostic. */
export class DevelopmentCommand {
  private readonly pending: { readonly command: DevelopmentAction; readonly operation: string }[] =
    [];
  private flushing = false;
  constructor(
    private readonly service: () => ServiceSupervisor | undefined,
    private readonly write = (value: string) => {
      writeSync(1, value);
    },
    private readonly prepare = async () => {},
  ) {}
  run(argv: readonly string[]): void {
    try {
      const command = parseDevelopmentSwitches(argv);
      if (!command) return;
      const operation = randomUUID();
      const service = this.service();
      if (command.action === "interrupt" && service?.available) {
        this.print({ operation_id: operation, action: command.action });
        if (!service.development(command, operation))
          this.print({ operation_id: operation, error: "service_unavailable" });
        return;
      }
      if (this.pending.length >= 20) {
        this.print({ operation_id: operation, error: "busy" });
        return;
      }
      this.pending.push({ command, operation });
      this.flush();
    } catch {
      this.print({ error: "invalid_development_command" });
    }
  }
  attach(service: ServiceSupervisor): void {
    service.observeDevelopment((message) => {
      this.print(message);
    });
    this.flush();
  }
  private flush(): void {
    if (this.flushing || !this.service()?.available || !this.pending.length) return;
    this.flushing = true;
    void (async () => {
      while (this.pending.length) {
        const service = this.service();
        if (!service?.available) break;
        const item = this.pending.shift();
        if (!item) break;
        // A native credential unlock can outlast service startup. Interrupt never waits on it.
        try {
          if (item.command.action === "request") await this.prepare();
          this.print({ operation_id: item.operation, action: item.command.action });
          if (service !== this.service() || !service.development(item.command, item.operation))
            this.print({ operation_id: item.operation, error: "service_unavailable" });
        } catch {
          this.print({ operation_id: item.operation, error: "service_unavailable" });
        }
      }
    })().finally(() => {
      this.flushing = false;
    });
  }
  private print(value: unknown): void {
    // JSON escaping prevents terminal-control injection from provider text.
    try {
      this.write(`${JSON.stringify(value)}\n`);
    } catch {
      /* A closed development terminal cannot fail the application. */
    }
  }
}
