#!/usr/bin/env node
import * as esbuild from "esbuild";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { readFileSync, chmodSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");

// Read package.json to get all dependencies
const pkg = JSON.parse(readFileSync(resolve(rootDir, "package.json"), "utf8"));
const allDeps = [
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.devDependencies || {}),
];

// Plugin to strip shebangs from source files (they get bundled otherwise)
const stripShebangPlugin = {
  name: "strip-shebang",
  setup(build) {
    build.onLoad({ filter: /\.ts$/ }, async (args) => {
      const source = readFileSync(args.path, "utf8");
      // Remove shebang if present
      const contents = source.replace(/^#!.*\n/, "");
      return { contents, loader: "ts" };
    });
  },
};

async function build() {
  // Unified CLI entry point
  const entryPoint = {
    entry: "src/agent/cli/index.ts",
    outfile: "bin/multica.mjs",
  };

  console.log(`Building ${entryPoint.entry} -> ${entryPoint.outfile}...`);

  await esbuild.build({
    entryPoints: [resolve(rootDir, entryPoint.entry)],
    outfile: resolve(rootDir, entryPoint.outfile),
    bundle: true,
    platform: "node",
    target: "node20",
    format: "esm",
    banner: {
      js: "#!/usr/bin/env node",
    },
    plugins: [stripShebangPlugin],
    sourcemap: true,
    minify: false,
    // Externalize all dependencies - they will be loaded from node_modules at runtime
    external: allDeps,
  });

  // Make executable
  chmodSync(resolve(rootDir, entryPoint.outfile), 0o755);
  console.log(`  ✓ ${entryPoint.outfile}`);

  console.log("\nBuild complete! Binary is in ./bin/");
  console.log("\nUsage:");
  console.log("  multica                    # Interactive mode (default)");
  console.log("  multica run <prompt>       # Run a single prompt");
  console.log("  multica chat               # Interactive mode");
  console.log("  multica session list       # List sessions");
  console.log("  multica profile list       # List profiles");
  console.log("  multica skills list        # List skills");
  console.log("  multica tools list         # List tools");
  console.log("  multica credentials init   # Initialize credentials");
  console.log("  multica dev                # Start dev servers");
  console.log("  multica help               # Show help");
  console.log("\nNote: The built binary requires node_modules to be present.");
  console.log("Run 'pnpm install --prod' to install only production dependencies.");
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
