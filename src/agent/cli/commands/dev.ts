/**
 * Dev command - Start development servers
 *
 * Usage:
 *   multica dev                Start all services (gateway + console + web)
 *   multica dev gateway        Start gateway only (:3000)
 *   multica dev console        Start console only (:4000)
 *   multica dev web            Start web app only (:3001)
 *   multica dev desktop        Start desktop app
 */

import { spawn } from "node:child_process";
import { cyan, yellow, green, dim, red } from "../colors.js";

type Service = "all" | "gateway" | "console" | "web" | "desktop" | "help";

function printHelp() {
  console.log(`
${cyan("Usage:")} multica dev [service]

${cyan("Services:")}
  ${yellow("(default)")}           Start all services (gateway + console + web)
  ${yellow("gateway")}             Start Gateway server (:3000)
  ${yellow("console")}             Start Console server (:4000)
  ${yellow("web")}                 Start Web app (:3001)
  ${yellow("desktop")}             Start Desktop app
  ${yellow("help")}                Show this help

${cyan("Architecture:")}
  Frontend (web:3001 / desktop)
    → Gateway (WebSocket, :3000)
      → Console Hub (multi-agent coordination, :4000)
        → Agent Engine

${cyan("Examples:")}
  ${dim("# Start all services")}
  multica dev

  ${dim("# Start only the gateway")}
  multica dev gateway

  ${dim("# Start web and gateway separately")}
  multica dev gateway &
  multica dev web
`);
}

interface DevOptions {
  service: Service;
  watch: boolean;
}

function parseArgs(argv: string[]): DevOptions {
  const args = [...argv];
  let service: Service = "all";
  let watch = true;

  while (args.length > 0) {
    const arg = args.shift();
    if (!arg) break;

    if (arg === "--help" || arg === "-h") {
      return { service: "help", watch };
    }
    if (arg === "--no-watch") {
      watch = false;
      continue;
    }

    // Service name
    if (["gateway", "console", "web", "desktop", "all", "help"].includes(arg)) {
      service = arg as Service;
    }
  }

  return { service, watch };
}

function runCommand(command: string, args: string[], options: { name: string; color: string }) {
  console.log(`${options.color}[${options.name}]${"\x1b[0m"} Starting...`);

  const child = spawn(command, args, {
    stdio: "inherit",
    shell: true,
  });

  child.on("error", (err) => {
    console.error(`${red(`[${options.name}]`)} Error: ${err.message}`);
  });

  child.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`${red(`[${options.name}]`)} Exited with code ${code}`);
    }
  });

  return child;
}

async function startGateway(watch: boolean) {
  const watchFlag = watch ? "--watch" : "";
  return runCommand("tsx", [watchFlag, "src/gateway/main.ts"].filter(Boolean), {
    name: "gateway",
    color: "\x1b[34m", // blue
  });
}

async function startConsole(watch: boolean) {
  const watchFlag = watch ? "--watch" : "";
  return runCommand("tsx", [watchFlag, "src/console/main.ts"].filter(Boolean), {
    name: "console",
    color: "\x1b[33m", // yellow
  });
}

async function startWeb() {
  return runCommand("pnpm", ["--filter", "@multica/web", "dev"], {
    name: "web",
    color: "\x1b[32m", // green
  });
}

async function startDesktop() {
  return runCommand("pnpm", ["--filter", "@multica/desktop", "dev"], {
    name: "desktop",
    color: "\x1b[35m", // magenta
  });
}

async function startAll(watch: boolean) {
  console.log(`\n${cyan("Starting all services...")}\n`);
  console.log(`  ${"\x1b[34m"}Gateway${"\x1b[0m"}  → http://localhost:3000`);
  console.log(`  ${"\x1b[33m"}Console${"\x1b[0m"}  → http://localhost:4000`);
  console.log(`  ${"\x1b[32m"}Web${"\x1b[0m"}      → http://localhost:3001`);
  console.log("");

  // Start all services
  const gateway = await startGateway(watch);
  const console_ = await startConsole(watch);
  const web = await startWeb();

  // Handle Ctrl+C
  const cleanup = () => {
    console.log(`\n${dim("Stopping all services...")}`);
    gateway.kill();
    console_.kill();
    web.kill();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // Wait for all to exit
  await Promise.all([
    new Promise((resolve) => gateway.on("exit", resolve)),
    new Promise((resolve) => console_.on("exit", resolve)),
    new Promise((resolve) => web.on("exit", resolve)),
  ]);
}

export async function devCommand(args: string[]): Promise<void> {
  const opts = parseArgs(args);

  switch (opts.service) {
    case "gateway":
      console.log(`\n${cyan("Starting Gateway...")} → http://localhost:3000\n`);
      await startGateway(opts.watch);
      break;

    case "console":
      console.log(`\n${cyan("Starting Console...")} → http://localhost:4000\n`);
      await startConsole(opts.watch);
      break;

    case "web":
      console.log(`\n${cyan("Starting Web App...")} → http://localhost:3001\n`);
      await startWeb();
      break;

    case "desktop":
      console.log(`\n${cyan("Starting Desktop App...")}\n`);
      await startDesktop();
      break;

    case "all":
      await startAll(opts.watch);
      break;

    case "help":
    default:
      printHelp();
      break;
  }
}
