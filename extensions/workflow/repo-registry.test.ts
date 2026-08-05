import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readRepositoryTracker, resolveRepositories } from "./index.ts";

const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

test("registry comes only from explicit settings and never scans directories", () => {
  assert.deepEqual(
    resolveRepositories(
      { workflow: { repositories: ["/work/a", "/work/b"] } },
      "/repo",
    ),
    { defaulted: false, paths: ["/work/a", "/work/b"] },
  );
  // No registry configured (or malformed) defaults to this repository only;
  // no directory scan or glob of home/work directories may happen.
  assert.deepEqual(resolveRepositories({}, "/repo"), {
    defaulted: true,
    paths: ["/repo"],
  });
  assert.deepEqual(resolveRepositories(undefined, "/repo"), {
    defaulted: true,
    paths: ["/repo"],
  });
  for (const bad of [
    { workflow: { repositories: [] } },
    { workflow: { repositories: "~/Work" } },
    { workflow: { repositories: [42] } },
    { workflow: { repositories: ["  "] } },
    { workflow: { repositories: ["/a", ""] } },
  ]) {
    assert.deepEqual(resolveRepositories(bad, "/repo"), {
      defaulted: true,
      paths: ["/repo"],
    });
  }
  assert.deepEqual(
    resolveRepositories(
      { workflow: { repositories: ["/a", "/a", "/b"] } },
      "/repo",
    ),
    { defaulted: false, paths: ["/a", "/b"] },
  );

  const registrySource = source.slice(
    source.indexOf("export function resolveRepositories"),
    source.indexOf("export async function readRepositoryTracker"),
  );
  assert.doesNotMatch(
    registrySource,
    /readdir|glob|opendir|scandir|walk|readFile|writeFile|exec|spawn|fetch|WebSocket|node:fs|node:child_process/,
  );
});

test("tracker reads are bounded, read-only, timestamped, and map failures to per-repo reasons", async () => {
  const calls: string[] = [];
  const read = async (path: string) => {
    calls.push(path);
    return "## PI-99 — sample\n\nStatus: **Done** · Blocked-by: none\n";
  };

  const ok = await readRepositoryTracker("/work/alpha", { readTracker: read });
  assert.deepEqual(calls, [join("/work/alpha", "tickets.md")]);
  assert.equal(ok.repo, "alpha");
  assert.equal(ok.snapshot?.records.length, 1);
  assert.equal(ok.snapshot?.records[0]?.id, "PI-99");
  assert.equal(ok.reason, undefined);
  assert.ok(ok.capturedAt > 0);

  const tilde = await readRepositoryTracker("~/work/alpha", {
    readTracker: read,
  });
  assert.deepEqual(calls.slice(-1), [
    join(homedir(), "work/alpha", "tickets.md"),
  ]);

  const missing = await readRepositoryTracker("/nope", {
    readTracker: async () => {
      const error = new Error("no such file") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    },
  });
  assert.equal(missing.snapshot, undefined);
  assert.equal(missing.reason, "no tracker");

  const unreadable = await readRepositoryTracker("/nope", {
    readTracker: async () => {
      throw new Error("permission denied");
    },
  });
  assert.equal(unreadable.snapshot, undefined);
  assert.equal(unreadable.reason, "unreadable");

  const timedOut = await readRepositoryTracker("/slow", {
    readTracker: () => new Promise<string>(() => {}),
    timeoutMs: 20,
  });
  assert.equal(timedOut.snapshot, undefined);
  assert.equal(timedOut.reason, "timeout");

  const empty = await readRepositoryTracker("/empty", {
    readTracker: async () => "",
  });
  assert.equal(empty.snapshot, undefined);
  assert.equal(empty.reason, "empty tracker");

  // Cross-repository access is read-only: only each declared repo's
  // tickets.md is read, and no write/commit/push/mutation API exists in the
  // cross-repository code path.
  const both = await Promise.all(
    ["/work/alpha", "/work/beta"].map((path) =>
      readRepositoryTracker(path, { readTracker: read }),
    ),
  );
  assert.deepEqual(
    both.map((entry) => entry.repo),
    ["alpha", "beta"],
  );
  assert.deepEqual(
    calls.filter((call) => call.endsWith("tickets.md")).slice(-2),
    [join("/work/alpha", "tickets.md"), join("/work/beta", "tickets.md")],
  );

  const crossRepoSource = source.slice(
    source.indexOf("export function resolveRepositories"),
    source.indexOf("export class FlowPanel"),
  );
  assert.match(crossRepoSource, /readFile/);
  assert.doesNotMatch(
    crossRepoSource,
    /writeFile|rename|mkdir|appendFile|unlink|rmSync|exec|spawn|fetch|WebSocket|readdir|glob|opendir|scandir|git|\bpush\b|\bcommit\b/,
  );
});
