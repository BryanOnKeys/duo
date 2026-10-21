import path from "node:path";

/** Drop parent app/session bindings while retaining CLI authentication and executable lookup. */
export function agentEnvironment(base, bin) {
  const env = { ...base };
  for (const key of Object.keys(env)) if (key.startsWith("CODEX_") && key !== "CODEX_HOME") delete env[key];
  if (bin) {
    const pathKey = Object.keys(env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
    env[pathKey] = `${bin}${path.delimiter}${env[pathKey] ?? ""}`;
  }
  return env;
}
