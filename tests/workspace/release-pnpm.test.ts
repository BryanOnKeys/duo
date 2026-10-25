import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pnpm, pnpmInvocation } from "../../scripts/release/common.mjs";

const directories: string[] = [];

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "duo pnpm invocation-"));
  directories.push(dir);
  const probe = path.join(dir, "pnpm-probe.cjs");
  fs.writeFileSync(probe, "console.log(JSON.stringify(process.argv.slice(2)));\n");
  return { dir, probe };
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("release pnpm invocation", () => {
  it.each(["js", "cjs", "mjs", "CJS"])("selects Node for .%s on all supported platforms", (extension) => {
    const entry = "/tools with spaces/pnpm/bin/pnpm." + extension;
    for (const platform of ["win32", "linux", "darwin"] as const) {
      expect(pnpmInvocation(entry, () => true, platform)).toEqual({ command: process.execPath, prefix: [entry], shell: false });
    }
  });

  it.each([
    ["win32", "C:\\tools with spaces\\pnpm.exe"],
    ["linux", "/tools with spaces/pnpm"],
    ["darwin", "/tools with spaces/pnpm"],
  ] as const)("selects the standalone binary directly on %s", (platform, entry) => {
    expect(pnpmInvocation(entry, () => true, platform)).toEqual({ command: entry, prefix: [], shell: false });
  });

  it.each(["cmd", "bat"])("uses a shell only for Windows .%s shims", (extension) => {
    const entry = "C:\\tools with spaces\\pnpm." + extension;
    expect(pnpmInvocation(entry, () => true, "win32")).toEqual({ command: `"${entry}"`, prefix: [], shell: true });
    for (const platform of ["linux", "darwin"] as const) {
      expect(pnpmInvocation(entry, () => true, platform)).toEqual({ command: entry, prefix: [], shell: false });
    }
  });

  it.each(["win32", "linux", "darwin"] as const)("preserves PATH fallback on %s", (platform) => {
    const fallback = { command: "pnpm", prefix: [], shell: platform === "win32" };
    expect(pnpmInvocation(undefined, () => true, platform)).toEqual(fallback);
    expect(pnpmInvocation("/tools/npm-cli.js", () => true, platform)).toEqual(fallback);
    expect(pnpmInvocation("/missing/pnpm.cjs", () => false, platform)).toEqual(fallback);
  });

  it.each(["js", "cjs", "mjs"])("runs a .%s entry point through Node", (extension) => {
    const { dir } = fixture();
    const entry = path.join(dir, "pnpm." + extension);
    fs.writeFileSync(entry, "console.log(JSON.stringify(process.argv.slice(2)));\n");
    vi.stubEnv("npm_execpath", entry);

    const result = pnpm(["build", "two words"]);
    expect(result.code, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(["build", "two words"]);
  });

  it("executes a standalone binary directly, including paths and arguments with spaces", () => {
    const { dir, probe } = fixture();
    const binary = path.join(dir, process.platform === "win32" ? "pnpm.exe" : "pnpm");
    if (process.platform === "win32") fs.copyFileSync(process.execPath, binary);
    else fs.symlinkSync(process.execPath, binary);
    vi.stubEnv("npm_execpath", binary);

    const result = pnpm([probe, "build", "two words"]);
    expect(result.code, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(["build", "two words"]);
  });

  it("falls back to the pnpm command on PATH", () => {
    const { dir } = fixture();
    const shim = path.join(dir, process.platform === "win32" ? "pnpm.cmd" : "pnpm");
    fs.writeFileSync(shim, process.platform === "win32"
      ? `@echo off\r\n"${process.execPath}" "%~dp0pnpm-probe.cjs" %*\r\n`
      : `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/pnpm-probe.cjs" "$@"\n`, { mode: 0o755 });
    vi.stubEnv("npm_execpath", undefined);
    vi.stubEnv("PATH", dir + path.delimiter + (process.env.PATH ?? ""));

    const result = pnpm(["build"]);
    expect(result.code, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(["build"]);
  });

  it.skipIf(process.platform !== "win32").each(["cmd", "bat"])("executes a Windows .%s shim from a path with spaces", (extension) => {
    const { dir } = fixture();
    const shim = path.join(dir, "pnpm." + extension);
    fs.writeFileSync(shim, `@echo off\r\n"${process.execPath}" "%~dp0pnpm-probe.cjs" %*\r\n`);
    vi.stubEnv("npm_execpath", shim);

    const result = pnpm(["build"]);
    expect(result.code, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(["build"]);
  });
});
