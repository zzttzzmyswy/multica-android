# Cron Job Tool 实现方案

## 概述

Cron Job Tool 允许 Agent 创建定时任务，在指定时间或周期性地执行操作。这对于提醒、定期检查、自动化工作流等场景非常有用。

## OpenClaw 实现分析

### 核心架构

```
┌─────────────────────────────────────────────────────────────┐
│                      CronService                             │
├─────────────────────────────────────────────────────────────┤
│  start()    → 加载 jobs, 计算下次运行时间, 启动 timer       │
│  add()      → 创建任务, 计算 schedule, 持久化               │
│  update()   → 修改任务, 重新计算 schedule                    │
│  remove()   → 删除任务                                       │
│  run()      → 立即执行任务                                   │
│  list()     → 列出所有任务                                   │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                      Timer Loop                              │
├─────────────────────────────────────────────────────────────┤
│  armTimer(nextWakeAtMs)                                      │
│       ↓                                                      │
│  onTimer() → runDueJobs() → executeJob()                    │
│       ↓                                                      │
│  Update state, re-arm timer                                  │
└─────────────────────────────────────────────────────────────┘
```

### Job 类型

**Schedule 类型：**
1. **at** - 一次性任务（指定时间戳）
2. **every** - 固定间隔（如每 30 分钟）
3. **cron** - 标准 cron 表达式（5 字段 + 可选时区）

**Session Target：**
1. **main** - 注入到主会话（作为系统事件）
2. **isolated** - 在独立会话中运行 agent turn

**Payload 类型：**
1. **systemEvent** - 注入文本到主会话
2. **agentTurn** - 在独立会话中执行 agent（可指定 model/thinking）

### 存储结构

```
~/.openclaw/cron/
├── jobs.json           # 所有任务定义
├── jobs.json.bak       # 备份
└── runs/
    ├── <jobId-1>.jsonl # 任务1的运行历史
    └── <jobId-2>.jsonl # 任务2的运行历史
```

---

## Super Multica 实现方案

### Phase 1: 核心数据结构

#### 1.1 Job 类型定义

**文件：** `src/cron/types.ts`

```typescript
import type { v7 as uuidv7 } from "uuid";

/** Cron 任务调度类型 */
export type CronSchedule =
  | { kind: "at"; atMs: number }                              // 一次性（时间戳）
  | { kind: "every"; everyMs: number; anchorMs?: number }     // 固定间隔
  | { kind: "cron"; expr: string; tz?: string };              // Cron 表达式

/** 任务执行目标 */
export type CronSessionTarget = "main" | "isolated";

/** 唤醒模式 */
export type CronWakeMode = "next-heartbeat" | "now";

/** 任务载荷 */
export type CronPayload =
  | {
      kind: "system-event";
      text: string;                    // 注入到主会话的文本
    }
  | {
      kind: "agent-turn";
      message: string;                 // Agent 执行的 prompt
      model?: string;                  // 可选 model override
      thinkingLevel?: string;          // 可选 thinking level
      timeoutSeconds?: number;         // 超时时间
    };

/** 任务运行状态 */
export type CronJobState = {
  nextRunAtMs?: number;               // 下次运行时间
  runningAtMs?: number;               // 正在运行的时间戳（锁）
  lastRunAtMs?: number;               // 上次运行时间
  lastStatus?: "ok" | "error" | "skipped";
  lastError?: string;
  lastDurationMs?: number;
};

/** Cron 任务定义 */
export type CronJob = {
  id: string;                         // UUID
  name: string;                       // 用户友好名称
  description?: string;               // 描述
  enabled: boolean;                   // 是否启用
  deleteAfterRun?: boolean;           // 运行后自动删除（一次性任务）
  createdAtMs: number;
  updatedAtMs: number;
  schedule: CronSchedule;
  sessionTarget: CronSessionTarget;
  wakeMode: CronWakeMode;
  payload: CronPayload;
  state: CronJobState;
};

/** 创建任务的输入 */
export type CronJobInput = Omit<CronJob, "id" | "createdAtMs" | "updatedAtMs" | "state">;

/** 运行日志条目 */
export type CronRunLogEntry = {
  ts: number;
  jobId: string;
  action: "run" | "skip" | "error";
  status: "ok" | "error" | "skipped";
  error?: string;
  summary?: string;
  durationMs?: number;
  nextRunAtMs?: number;
};
```

#### 1.2 存储层

**文件：** `src/cron/store.ts`

```typescript
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import type { CronJob, CronRunLogEntry } from "./types.js";

const DEFAULT_CRON_DIR = path.join(
  process.env["HOME"] ?? ".",
  ".super-multica",
  "cron"
);

export class CronStore {
  private readonly jobsPath: string;
  private readonly runsDir: string;
  private jobs: Map<string, CronJob> = new Map();

  constructor(baseDir: string = DEFAULT_CRON_DIR) {
    this.jobsPath = path.join(baseDir, "jobs.json");
    this.runsDir = path.join(baseDir, "runs");
    this.ensureDirs();
  }

  private ensureDirs() {
    const dir = path.dirname(this.jobsPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    if (!existsSync(this.runsDir)) mkdirSync(this.runsDir, { recursive: true });
  }

  load(): CronJob[] {
    if (!existsSync(this.jobsPath)) return [];
    const data = JSON.parse(readFileSync(this.jobsPath, "utf-8"));
    this.jobs = new Map(data.jobs.map((j: CronJob) => [j.id, j]));
    return Array.from(this.jobs.values());
  }

  save() {
    const jobs = Array.from(this.jobs.values());
    // Backup first
    if (existsSync(this.jobsPath)) {
      writeFileSync(this.jobsPath + ".bak", readFileSync(this.jobsPath));
    }
    writeFileSync(this.jobsPath, JSON.stringify({ jobs }, null, 2));
  }

  get(id: string): CronJob | undefined {
    return this.jobs.get(id);
  }

  set(job: CronJob) {
    this.jobs.set(job.id, job);
    this.save();
  }

  delete(id: string): boolean {
    const deleted = this.jobs.delete(id);
    if (deleted) this.save();
    return deleted;
  }

  list(filter?: { enabled?: boolean }): CronJob[] {
    let jobs = Array.from(this.jobs.values());
    if (filter?.enabled !== undefined) {
      jobs = jobs.filter((j) => j.enabled === filter.enabled);
    }
    return jobs;
  }

  // Run log methods
  appendRunLog(jobId: string, entry: CronRunLogEntry) {
    const logPath = path.join(this.runsDir, `${jobId}.jsonl`);
    const line = JSON.stringify(entry) + "\n";
    writeFileSync(logPath, line, { flag: "a" });
  }

  getRunLogs(jobId: string, limit = 50): CronRunLogEntry[] {
    const logPath = path.join(this.runsDir, `${jobId}.jsonl`);
    if (!existsSync(logPath)) return [];
    const lines = readFileSync(logPath, "utf-8").trim().split("\n");
    return lines.slice(-limit).map((l) => JSON.parse(l));
  }
}
```

---

### Phase 2: Cron Service

**文件：** `src/cron/service.ts`

```typescript
import { v7 as uuidv7 } from "uuid";
import Croner from "croner";
import type { CronJob, CronJobInput, CronSchedule } from "./types.js";
import { CronStore } from "./store.js";

export class CronService {
  private store: CronStore;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(store?: CronStore) {
    this.store = store ?? new CronStore();
  }

  /** 启动服务 */
  async start() {
    if (this.running) return;
    this.running = true;
    this.store.load();
    this.recomputeAllSchedules();
    this.armTimer();
  }

  /** 停止服务 */
  stop() {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** 获取服务状态 */
  status() {
    const jobs = this.store.list({ enabled: true });
    const nextWake = Math.min(
      ...jobs.map((j) => j.state.nextRunAtMs ?? Infinity)
    );
    return {
      running: this.running,
      jobCount: jobs.length,
      nextWakeAtMs: nextWake === Infinity ? null : nextWake,
    };
  }

  /** 列出任务 */
  list(filter?: { enabled?: boolean }) {
    return this.store.list(filter);
  }

  /** 添加任务 */
  add(input: CronJobInput): CronJob {
    const now = Date.now();
    const job: CronJob = {
      ...input,
      id: uuidv7(),
      createdAtMs: now,
      updatedAtMs: now,
      state: {},
    };
    this.computeNextRun(job);
    this.store.set(job);
    this.armTimer();
    return job;
  }

  /** 更新任务 */
  update(id: string, patch: Partial<CronJobInput>): CronJob | null {
    const job = this.store.get(id);
    if (!job) return null;

    Object.assign(job, patch, { updatedAtMs: Date.now() });
    if (patch.schedule) {
      this.computeNextRun(job);
    }
    this.store.set(job);
    this.armTimer();
    return job;
  }

  /** 删除任务 */
  remove(id: string): boolean {
    return this.store.delete(id);
  }

  /** 立即运行任务 */
  async run(id: string, force = false): Promise<{ ok: boolean; reason?: string }> {
    const job = this.store.get(id);
    if (!job) return { ok: false, reason: "Job not found" };
    if (!job.enabled && !force) return { ok: false, reason: "Job disabled" };

    await this.executeJob(job);
    return { ok: true };
  }

  /** 获取运行日志 */
  getRunLogs(id: string) {
    return this.store.getRunLogs(id);
  }

  // === Private Methods ===

  private computeNextRun(job: CronJob) {
    const now = Date.now();
    let nextMs: number;

    switch (job.schedule.kind) {
      case "at":
        nextMs = job.schedule.atMs;
        break;
      case "every":
        const anchor = job.schedule.anchorMs ?? now;
        const interval = job.schedule.everyMs;
        const elapsed = now - anchor;
        const periods = Math.ceil(elapsed / interval);
        nextMs = anchor + periods * interval;
        break;
      case "cron":
        const cron = Croner(job.schedule.expr, {
          timezone: job.schedule.tz,
        });
        const next = cron.nextRun();
        nextMs = next ? next.getTime() : now + 86400000; // fallback 1 day
        break;
    }

    job.state.nextRunAtMs = nextMs;
  }

  private recomputeAllSchedules() {
    for (const job of this.store.list({ enabled: true })) {
      this.computeNextRun(job);
      this.store.set(job);
    }
  }

  private armTimer() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const jobs = this.store.list({ enabled: true });
    const nextWake = Math.min(
      ...jobs.map((j) => j.state.nextRunAtMs ?? Infinity)
    );

    if (nextWake === Infinity) return;

    const delay = Math.max(0, nextWake - Date.now());
    this.timer = setTimeout(() => this.onTimer(), delay);
  }

  private async onTimer() {
    const now = Date.now();
    const dueJobs = this.store
      .list({ enabled: true })
      .filter((j) => (j.state.nextRunAtMs ?? Infinity) <= now);

    for (const job of dueJobs) {
      await this.executeJob(job);
    }

    this.armTimer();
  }

  private async executeJob(job: CronJob) {
    const startMs = Date.now();
    job.state.runningAtMs = startMs;
    this.store.set(job);

    try {
      // TODO: 实际执行逻辑
      // - systemEvent: 注入到主会话
      // - agentTurn: 在独立会话中运行 agent
      console.log(`[Cron] Executing job: ${job.name} (${job.id})`);

      // 模拟执行
      await new Promise((r) => setTimeout(r, 100));

      // 更新状态
      job.state.lastRunAtMs = startMs;
      job.state.lastStatus = "ok";
      job.state.lastDurationMs = Date.now() - startMs;
      job.state.runningAtMs = undefined;

      // 一次性任务处理
      if (job.schedule.kind === "at") {
        if (job.deleteAfterRun) {
          this.store.delete(job.id);
        } else {
          job.enabled = false;
        }
      } else {
        this.computeNextRun(job);
      }

      this.store.set(job);
      this.store.appendRunLog(job.id, {
        ts: startMs,
        jobId: job.id,
        action: "run",
        status: "ok",
        durationMs: job.state.lastDurationMs,
        nextRunAtMs: job.state.nextRunAtMs,
      });
    } catch (error) {
      job.state.lastRunAtMs = startMs;
      job.state.lastStatus = "error";
      job.state.lastError = String(error);
      job.state.lastDurationMs = Date.now() - startMs;
      job.state.runningAtMs = undefined;
      this.computeNextRun(job);
      this.store.set(job);
      this.store.appendRunLog(job.id, {
        ts: startMs,
        jobId: job.id,
        action: "error",
        status: "error",
        error: String(error),
        durationMs: job.state.lastDurationMs,
      });
    }
  }
}
```

---

### Phase 3: Agent Tool

**文件：** `src/agent/tools/cron/cron-tool.ts`

```typescript
import type { Tool } from "@mariozechner/pi-agent-core";
import { CronService } from "../../../cron/service.js";

let cronService: CronService | null = null;

export function getCronService(): CronService {
  if (!cronService) {
    cronService = new CronService();
    cronService.start();
  }
  return cronService;
}

export const cronTool: Tool = {
  name: "cron",
  description: `Create, manage, and execute scheduled tasks (cron jobs).

## Actions

### list
List all cron jobs.
\`\`\`json
{ "action": "list", "enabled": true }
\`\`\`

### add
Create a new cron job.
\`\`\`json
{
  "action": "add",
  "name": "Daily reminder",
  "schedule": { "kind": "cron", "expr": "0 9 * * *", "tz": "Asia/Shanghai" },
  "sessionTarget": "main",
  "wakeMode": "now",
  "payload": { "kind": "system-event", "text": "Check your todos!" }
}
\`\`\`

Schedule types:
- \`{ "kind": "at", "atMs": 1704067200000 }\` - One-time at timestamp
- \`{ "kind": "every", "everyMs": 3600000 }\` - Every hour
- \`{ "kind": "cron", "expr": "0 9 * * *", "tz": "Asia/Shanghai" }\` - Cron expression

### update
Update an existing job.
\`\`\`json
{ "action": "update", "jobId": "xxx", "enabled": false }
\`\`\`

### remove
Delete a job.
\`\`\`json
{ "action": "remove", "jobId": "xxx" }
\`\`\`

### run
Execute a job immediately.
\`\`\`json
{ "action": "run", "jobId": "xxx", "force": true }
\`\`\`

### status
Get cron service status.
\`\`\`json
{ "action": "status" }
\`\`\`
`,

  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["list", "add", "update", "remove", "run", "status"],
        description: "The action to perform",
      },
      // list
      enabled: { type: "boolean", description: "Filter by enabled status" },
      // add
      name: { type: "string", description: "Job name" },
      description: { type: "string", description: "Job description" },
      schedule: { type: "object", description: "Schedule configuration" },
      sessionTarget: {
        type: "string",
        enum: ["main", "isolated"],
        description: "Where to run the job",
      },
      wakeMode: {
        type: "string",
        enum: ["next-heartbeat", "now"],
        description: "When to wake after job",
      },
      payload: { type: "object", description: "Job payload" },
      deleteAfterRun: { type: "boolean", description: "Delete after one-time run" },
      // update/remove/run
      jobId: { type: "string", description: "Job ID" },
      // run
      force: { type: "boolean", description: "Force run even if disabled" },
    },
    required: ["action"],
  },

  execute: async (params: Record<string, unknown>) => {
    const service = getCronService();
    const action = params["action"] as string;

    switch (action) {
      case "status":
        return JSON.stringify(service.status(), null, 2);

      case "list":
        const jobs = service.list({
          enabled: params["enabled"] as boolean | undefined,
        });
        return JSON.stringify(jobs, null, 2);

      case "add":
        const newJob = service.add({
          name: params["name"] as string,
          description: params["description"] as string | undefined,
          enabled: true,
          deleteAfterRun: params["deleteAfterRun"] as boolean | undefined,
          schedule: params["schedule"] as any,
          sessionTarget: (params["sessionTarget"] as any) ?? "main",
          wakeMode: (params["wakeMode"] as any) ?? "next-heartbeat",
          payload: params["payload"] as any,
        });
        return `Created job: ${newJob.name} (${newJob.id})\nNext run: ${new Date(newJob.state.nextRunAtMs!).toISOString()}`;

      case "update":
        const updated = service.update(params["jobId"] as string, params as any);
        if (!updated) return "Job not found";
        return `Updated job: ${updated.name}`;

      case "remove":
        const removed = service.remove(params["jobId"] as string);
        return removed ? "Job removed" : "Job not found";

      case "run":
        const result = await service.run(
          params["jobId"] as string,
          params["force"] as boolean
        );
        return result.ok ? "Job executed" : `Failed: ${result.reason}`;

      default:
        return `Unknown action: ${action}`;
    }
  },
};
```

---

### Phase 4: CLI 命令

**文件：** `src/agent/cli/commands/cron.ts`

```typescript
import { Command } from "commander";
import { getCronService } from "../../tools/cron/cron-tool.js";

export function registerCronCommands(program: Command) {
  const cron = program.command("cron").description("Manage cron jobs");

  cron
    .command("status")
    .description("Show cron service status")
    .action(() => {
      const service = getCronService();
      const status = service.status();
      console.log("Cron Service Status:");
      console.log(`  Running: ${status.running}`);
      console.log(`  Jobs: ${status.jobCount}`);
      if (status.nextWakeAtMs) {
        console.log(`  Next wake: ${new Date(status.nextWakeAtMs).toISOString()}`);
      }
    });

  cron
    .command("list")
    .description("List all cron jobs")
    .option("--enabled", "Show only enabled jobs")
    .option("--disabled", "Show only disabled jobs")
    .action((opts) => {
      const service = getCronService();
      const enabled = opts.enabled ? true : opts.disabled ? false : undefined;
      const jobs = service.list({ enabled });

      if (jobs.length === 0) {
        console.log("No cron jobs found.");
        return;
      }

      for (const job of jobs) {
        console.log(`\n${job.enabled ? "✓" : "✗"} ${job.name} (${job.id})`);
        console.log(`  Schedule: ${formatSchedule(job.schedule)}`);
        console.log(`  Target: ${job.sessionTarget}`);
        if (job.state.nextRunAtMs) {
          console.log(`  Next run: ${new Date(job.state.nextRunAtMs).toISOString()}`);
        }
        if (job.state.lastStatus) {
          console.log(`  Last run: ${job.state.lastStatus} (${job.state.lastDurationMs}ms)`);
        }
      }
    });

  cron
    .command("add")
    .description("Add a new cron job")
    .requiredOption("-n, --name <name>", "Job name")
    .option("--at <time>", "One-time at ISO timestamp or relative (e.g., '10m', '2h')")
    .option("--every <interval>", "Repeat interval (e.g., '30m', '1h', '1d')")
    .option("--cron <expr>", "Cron expression (5-field)")
    .option("--tz <timezone>", "Timezone for cron expression")
    .option("--message <text>", "System event text or agent prompt")
    .option("--isolated", "Run in isolated session")
    .option("--delete-after-run", "Delete after one-time run")
    .action((opts) => {
      const service = getCronService();

      let schedule;
      if (opts.at) {
        schedule = { kind: "at" as const, atMs: parseTime(opts.at) };
      } else if (opts.every) {
        schedule = { kind: "every" as const, everyMs: parseInterval(opts.every) };
      } else if (opts.cron) {
        schedule = { kind: "cron" as const, expr: opts.cron, tz: opts.tz };
      } else {
        console.error("Must specify --at, --every, or --cron");
        return;
      }

      const job = service.add({
        name: opts.name,
        enabled: true,
        deleteAfterRun: opts.deleteAfterRun,
        schedule,
        sessionTarget: opts.isolated ? "isolated" : "main",
        wakeMode: "now",
        payload: {
          kind: "system-event",
          text: opts.message ?? "Cron job triggered",
        },
      });

      console.log(`Created job: ${job.name} (${job.id})`);
      console.log(`Next run: ${new Date(job.state.nextRunAtMs!).toISOString()}`);
    });

  // ... more commands: run, remove, enable, disable, logs
}

function formatSchedule(schedule: any): string {
  switch (schedule.kind) {
    case "at":
      return `at ${new Date(schedule.atMs).toISOString()}`;
    case "every":
      return `every ${schedule.everyMs}ms`;
    case "cron":
      return `cron "${schedule.expr}"${schedule.tz ? ` (${schedule.tz})` : ""}`;
  }
}

function parseTime(s: string): number {
  // Handle relative times like "10m", "2h"
  const match = s.match(/^(\d+)([smhd])$/);
  if (match) {
    const [, num, unit] = match;
    const ms = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    }[unit]!;
    return Date.now() + parseInt(num) * ms;
  }
  return new Date(s).getTime();
}

function parseInterval(s: string): number {
  return parseTime(s) - Date.now();
}
```

---

## 实现顺序

| Phase | 内容 | 优先级 |
|-------|------|--------|
| **1** | 类型定义 + 存储层 | P0 |
| **2** | CronService 核心逻辑 | P0 |
| **3** | Agent Tool (cron) | P0 |
| **4** | CLI 命令 (multica cron) | P1 |
| **5** | 独立会话执行 (isolated agent turn) | P1 |
| **6** | Hub 集成 (Gateway API) | P2 |
| **7** | Desktop UI 管理界面 | P2 |

---

## 与 OpenClaw 的差异

| 特性 | OpenClaw | Super Multica (建议) |
|------|----------|---------------------|
| 存储位置 | `~/.openclaw/cron/` | `~/.super-multica/cron/` |
| 独立会话 | 完整实现 | Phase 1 先实现 main session |
| 消息投递 | 支持 WhatsApp/Telegram 等 | 暂不实现 |
| Gateway API | 完整实现 | Phase 2 实现 |
| 并发控制 | maxConcurrentRuns | 暂时单线程执行 |

---

## 使用示例

```bash
# CLI: 10分钟后提醒
multica cron add --name "Reminder" --at "10m" --message "Time to take a break!"

# CLI: 每天早上9点（北京时间）
multica cron add --name "Morning check" --cron "0 9 * * *" --tz "Asia/Shanghai" \
  --message "Good morning! Check your tasks."

# CLI: 每30分钟
multica cron add --name "Health check" --every "30m" --message "System health check"

# Agent Tool 调用
{
  "action": "add",
  "name": "Daily standup reminder",
  "schedule": { "kind": "cron", "expr": "55 9 * * 1-5", "tz": "Asia/Shanghai" },
  "sessionTarget": "main",
  "payload": { "kind": "system-event", "text": "Standup meeting in 5 minutes!" }
}
```

---

## 依赖

需要添加的依赖：
```bash
pnpm add croner  # Cron 表达式解析库
```

---

## 风险和注意事项

1. **进程生命周期**: Desktop app 关闭后 timer 停止，需要重启时恢复
2. **时区处理**: 使用 `croner` 库正确处理时区
3. **并发安全**: 文件操作需要加锁防止竞争
4. **内存泄漏**: 确保 timer 正确清理
5. **错误恢复**: Job 执行失败不应影响其他 job
