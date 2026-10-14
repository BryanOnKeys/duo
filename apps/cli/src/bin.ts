#!/usr/bin/env node
/**
 * The duoctl executable (package.json bin, T17.1). It checks the Node.js version first, then loads the
 * CLI. The CLI itself (main.ts) is the same in the workspace and in the published package; this file
 * only guards the start: an unsupported Node or an incomplete installation gets a clear message.
 */
import { nodeVersionProblem } from "./node-version.js";
import { NODE_ENGINE, RUNTIME_DEPENDENCIES } from "./version.js";

const problem = nodeVersionProblem(process.version, NODE_ENGINE);
if (problem !== undefined) {
  process.stderr.write(`${problem}\n`);
  process.exit(1);
}
const missing = (e: NodeJS.ErrnoException) => e.code === "ERR_MODULE_NOT_FOUND" || e.code === "MODULE_NOT_FOUND";
const incomplete = (e: NodeJS.ErrnoException): never => {
  process.stderr.write(`duoctl: this DUO installation is incomplete (${e.message.split("\n")[0] ?? ""}). Reinstall the @duo-director/cli package.\n`);
  process.exit(1);
};
// #8: heavy dependencies load on first use, so a missing one would otherwise surface only later. Resolving (not
// loading) every declared dependency keeps an incomplete installation reported before anything runs.
for (const dependency of RUNTIME_DEPENDENCIES) {
  try {
    import.meta.resolve(dependency);
  } catch (error) {
    if (missing(error as NodeJS.ErrnoException)) incomplete(error as NodeJS.ErrnoException);
  }
}
try {
  await import("./main.js");
} catch (error) {
  if (missing(error as NodeJS.ErrnoException)) incomplete(error as NodeJS.ErrnoException);
  throw error;
}
