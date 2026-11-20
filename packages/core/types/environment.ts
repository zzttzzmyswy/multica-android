/**
 * Issue environments — the servers and desktop apps an issue's runs leave
 * running. Mirrors web's `packages/core/types/environment.ts` field for field,
 * because both clients read the same `GET /api/issues/:id/environments`
 * payload and the same command responses.
 *
 * A row's lifecycle, in the server's own words:
 *   - `config`   — declared in `.multica/environments.toml` and started by the
 *                  daemon, so it can be supervised (stopped, restarted, logged);
 *   - `detected` — a server the daemon merely found listening inside a run's
 *                  directory. Nobody started it through Multica, so there is no
 *                  command to run against it.
 */

/** Where an environment came from. */
export type IssueEnvironmentSource = "config" | "detected";

/** A `server` opens at its URL; an `app` is a desktop app with no URL, whose
 *  window only the machine running it can bring forward. */
export type IssueEnvironmentKind = "server" | "app";

/** `unreachable` is derived by the server when the daemon that reported a live
 *  environment has gone quiet — the row is still `ended_at: null`, but nothing
 *  is answering. */
export type IssueEnvironmentState =
  | "starting"
  | "running"
  | "exited"
  | "stopped"
  | "unreachable";

export type IssueEnvironmentAction = "stop" | "restart" | "start" | "logs";

/** `pending` covers both queued and claimed; `expired` means the machine never
 *  answered in time. */
export type IssueEnvironmentActionStatus =
  | "pending"
  | "succeeded"
  | "failed"
  | "expired";

/** A stop, restart, start or log read a member asked a machine to perform. */
export interface IssueEnvironmentActionRecord {
  id: string;
  action: IssueEnvironmentAction;
  status: IssueEnvironmentActionStatus;
  error: string;
  environment_id: string | null;
  runtime_id: string;
  /** The run a start was asked of. */
  task_id: string | null;
  repo: string;
  name: string;
  actor_type: string;
  actor_id: string | null;
  created_at: string;
  completed_at: string | null;
}

/** A command's answer. A `logs` command carries what the machine read. */
export interface IssueEnvironmentCommand extends IssueEnvironmentActionRecord {
  /** The log a `logs` command read, once it succeeded. */
  output: string | null;
}

export interface IssueEnvironment {
  id: string;
  issue_id: string;
  task_id: string;
  runtime_id: string | null;
  agent_id: string | null;
  /** The reporting daemon's own name for the environment. */
  local_key: string;
  source: IssueEnvironmentSource;
  kind: IssueEnvironmentKind;
  /** The checkout a declared environment runs from; empty for detected ones
   *  and from older daemons. */
  repo: string;
  name: string;
  label: string;
  url: string;
  port: number | null;
  state: IssueEnvironmentState;
  detail: string;
  /** The last lines a crashed environment printed, redacted by the server. */
  excerpt: string;
  started_at: string;
  expires_at: string | null;
  last_seen_at: string;
  ended_at: string | null;
  /** Reported by a daemon that carries out section commands. */
  controllable: boolean;
  /** The caller may stop or restart it. */
  can_control: boolean;
  pending_action: IssueEnvironmentActionRecord | null;
  last_action: IssueEnvironmentActionRecord | null;
  /** The section's start or restart that created this row. */
  origin: IssueEnvironmentActionRecord | null;
}

/** One environment a repository declares, as the start menu offers it. */
export interface DeclaredEnvironment {
  repo: string;
  name: string;
  label: string;
  start: string;
}

/** What the latest run on one machine declared. */
export interface IssueEnvironmentConfig {
  runtime_id: string;
  task_id: string;
  reported_at: string;
  can_control: boolean;
  environments: DeclaredEnvironment[];
}

export interface IssueEnvironmentsResponse {
  environments: IssueEnvironment[];
  configs: IssueEnvironmentConfig[];
  /** Section starts whose environment has not been reported yet. */
  pending_starts: IssueEnvironmentActionRecord[];
  /** Recent section starts that failed or were never answered, and have not
   *  been tried again since. */
  failed_starts: IssueEnvironmentActionRecord[];
}

/** The body of a start: which run's code to start, and which declared
 *  environment of it. */
export interface StartIssueEnvironmentRequest {
  task_id: string;
  repo: string;
  name: string;
}
