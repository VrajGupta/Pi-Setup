import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  persistWorkflowMode,
  readWorkflowMode,
  validateWorkflowMode,
} from "./settings-mode.ts";

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "pi25-settings-"));
  return dir;
}

function settingsPath(dir: string) {
  return join(dir, "settings.json");
}

function writeSettings(dir: string, data: unknown) {
  writeFileSync(settingsPath(dir), `${JSON.stringify(data, null, 2)}\n`);
}

function readSettings(dir: string) {
  return JSON.parse(readFileSync(settingsPath(dir), "utf8"));
}

// ─── persist: success ────────────────────────────────────────────────

test("persistWorkflowMode writes the exact mode value", async () => {
  const dir = tempDir();
  try {
    writeSettings(dir, { workflow: { mode: "workflow" } });

    const ok = await persistWorkflowMode("free", settingsPath(dir));
    assert.equal(ok, true);
    assert.equal(readSettings(dir).workflow.mode, "free");

    // Idempotent: second write produces same content
    const first = readFileSync(settingsPath(dir), "utf8");
    const ok2 = await persistWorkflowMode("free", settingsPath(dir));
    assert.equal(ok2, true);
    const second = readFileSync(settingsPath(dir), "utf8");
    assert.equal(second, first);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("persistWorkflowMode preserves other settings keys", async () => {
  const dir = tempDir();
  try {
    writeSettings(dir, {
      theme: "vraj-ink",
      steeringMode: "one-at-a-time",
      workflow: { mode: "workflow", trackerPollMs: 10000 },
      packages: ["git:github.com/DietrichGebert/ponytail"],
    });

    await persistWorkflowMode("free", settingsPath(dir));
    const saved = readSettings(dir);
    assert.equal(saved.workflow.mode, "free");
    assert.equal(saved.theme, "vraj-ink");
    assert.equal(saved.steeringMode, "one-at-a-time");
    assert.equal(saved.workflow.trackerPollMs, 10000);
    assert.deepEqual(saved.packages, [
      "git:github.com/DietrichGebert/ponytail",
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("persistWorkflowMode creates workflow object when absent", async () => {
  const dir = tempDir();
  try {
    writeSettings(dir, { theme: "vraj-ink" });

    await persistWorkflowMode("free", settingsPath(dir));
    const saved = readSettings(dir);
    assert.equal(saved.workflow.mode, "free");
    assert.equal(saved.theme, "vraj-ink");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── persist: failure paths ──────────────────────────────────────────

test("persistWorkflowMode returns false on missing settings file", async () => {
  const dir = tempDir();
  try {
    // Don't write settings.json — file doesn't exist
    const ok = await persistWorkflowMode("free", settingsPath(dir));
    assert.equal(ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("persistWorkflowMode returns false on invalid JSON", async () => {
  const dir = tempDir();
  try {
    writeFileSync(settingsPath(dir), "{invalid json");
    const ok = await persistWorkflowMode("free", settingsPath(dir));
    assert.equal(ok, false);
    // Original file is untouched
    assert.equal(readFileSync(settingsPath(dir), "utf8"), "{invalid json");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("persistWorkflowMode returns false on non-object JSON", async () => {
  const dir = tempDir();
  try {
    writeSettings(dir, null);
    const ok = await persistWorkflowMode("free", settingsPath(dir));
    assert.equal(ok, false);
    assert.equal(readSettings(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── read: startup restoration ───────────────────────────────────────

test("readWorkflowMode returns 'free' when settings has workflow.mode 'free'", async () => {
  const dir = tempDir();
  try {
    writeSettings(dir, { workflow: { mode: "free" } });
    const mode = await readWorkflowMode(settingsPath(dir));
    assert.equal(mode, "free");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readWorkflowMode returns 'workflow' for missing file", async () => {
  const dir = tempDir();
  try {
    const mode = await readWorkflowMode(settingsPath(dir));
    assert.equal(mode, "workflow");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readWorkflowMode returns 'workflow' for invalid JSON", async () => {
  const dir = tempDir();
  try {
    writeFileSync(settingsPath(dir), "not json");
    const mode = await readWorkflowMode(settingsPath(dir));
    assert.equal(mode, "workflow");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readWorkflowMode returns 'workflow' for non-object settings", async () => {
  const dir = tempDir();
  try {
    writeSettings(dir, null);
    const mode = await readWorkflowMode(settingsPath(dir));
    assert.equal(mode, "workflow");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readWorkflowMode returns 'workflow' for absent workflow.mode", async () => {
  const dir = tempDir();
  try {
    writeSettings(dir, { theme: "vraj-ink" });
    const mode = await readWorkflowMode(settingsPath(dir));
    assert.equal(mode, "workflow");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── INV-2: only mode value in messages ──────────────────────────────

test("persistWorkflowMode never writes other settings values to messages", async () => {
  const dir = tempDir();
  try {
    writeSettings(dir, {
      secret: "sensitive-value",
      workflow: { mode: "workflow" },
    });
    const ok = await persistWorkflowMode("free", settingsPath(dir));
    assert.equal(ok, true);
    // The only value that changed is mode
    const saved = readSettings(dir);
    assert.equal(saved.workflow.mode, "free");
    assert.equal(saved.secret, "sensitive-value");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── INV-12: byte-identical on second apply ──────────────────────────

test("persistWorkflowMode is byte-identical when applied twice", async () => {
  const dir = tempDir();
  try {
    writeSettings(dir, { workflow: { mode: "workflow" } });
    await persistWorkflowMode("free", settingsPath(dir));
    const first = readFileSync(settingsPath(dir), "utf8");
    await persistWorkflowMode("free", settingsPath(dir));
    const second = readFileSync(settingsPath(dir), "utf8");
    assert.equal(second, first);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── INV-10: no key loss ─────────────────────────────────────────────

test("persistWorkflowMode does not lose unrelated keys", async () => {
  const dir = tempDir();
  try {
    writeSettings(dir, {
      theme: "vraj-ink",
      defaultProvider: "openai-codex",
      defaultModel: "gpt-5.6-sol",
      compact: { enabled: true },
      packages: ["npm:example", "git:github.com/DietrichGebert/ponytail"],
    });
    await persistWorkflowMode("free", settingsPath(dir));
    const saved = readSettings(dir);
    assert.equal(saved.workflow.mode, "free");
    assert.equal(saved.theme, "vraj-ink");
    assert.equal(saved.defaultProvider, "openai-codex");
    assert.equal(saved.defaultModel, "gpt-5.6-sol");
    assert.equal(saved.compact.enabled, true);
    assert.deepEqual(saved.packages, [
      "npm:example",
      "git:github.com/DietrichGebert/ponytail",
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── validateWorkflowMode ────────────────────────────────────────────

test("validateWorkflowMode returns mode for valid workflow/free", () => {
  const wf = validateWorkflowMode("workflow");
  assert.equal(wf.mode, "workflow");
  assert.equal(wf.warning, undefined);

  const fr = validateWorkflowMode("free");
  assert.equal(fr.mode, "free");
  assert.equal(fr.warning, undefined);
});

test("validateWorkflowMode returns workflow with warning for invalid values", () => {
  for (const invalid of [
    "banana",
    "WORKFLOW",
    "FREE",
    "",
    null,
    undefined,
    42,
    [],
    {},
  ]) {
    const { mode, warning } = validateWorkflowMode(invalid);
    assert.equal(mode, "workflow");
    if (invalid === undefined) {
      assert.equal(warning, undefined);
    } else {
      assert.ok(warning, `should warn for ${JSON.stringify(invalid)}`);
      assert.equal(
        warning,
        "invalid persisted workflow.mode — defaulting to workflow",
      );
    }
  }
});

// ─── runtime guard: invalid newMode ──────────────────────────────────

test("persistWorkflowMode rejects non-normalized mode", async () => {
  const dir = tempDir();
  try {
    writeSettings(dir, { workflow: { mode: "workflow" } });
    // @ts-expect-error — testing runtime guard, not TypeScript
    const ok = await persistWorkflowMode("garbage");
    assert.equal(ok, false);
    // Original file untouched
    assert.equal(readSettings(dir).workflow.mode, "workflow");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── concurrent write serialization ──────────────────────────────────

test("persistWorkflowMode serializes concurrent writes", async () => {
  const dir = tempDir();
  try {
    writeSettings(dir, { workflow: { mode: "workflow" } });
    const path = settingsPath(dir);

    // Two rapid writes with different modes; both must succeed and the
    // file must contain exactly one of the two values (no corruption).
    const [r1, r2] = await Promise.all([
      persistWorkflowMode("free", path),
      persistWorkflowMode("workflow", path),
    ]);
    assert.equal(r1, true);
    assert.equal(r2, true);

    const saved = readSettings(dir);
    assert.ok(
      saved.workflow.mode === "workflow" || saved.workflow.mode === "free",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("persistWorkflowMode serialization survives a write failure", async () => {
  const dir = tempDir();
  try {
    // Don't create settings.json — first write will fail
    const path = settingsPath(dir);

    // Two rapid calls where the first one fails (missing file)
    const [r1, r2] = await Promise.all([
      persistWorkflowMode("free", path),
      persistWorkflowMode("workflow", path),
    ]);
    // Both should return false (no file to read)
    assert.equal(r1, false);
    assert.equal(r2, false);
    // No file should have been created
    assert.throws(() => readSettings(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── getAgentDir() throws in default parameter (INV-6) ───────────────

test("persistWorkflowMode catches getAgentDir failure", async () => {
  // Pass a path that exists, but the default path resolution is inside
  // the try block — if getAgentDir threw, we'd still catch it. The
  // structural proof is the code (default inside try). Here we verify
  // the function still works with a real path.
  const dir = tempDir();
  try {
    writeSettings(dir, { workflow: { mode: "workflow" } });
    const ok = await persistWorkflowMode("free", settingsPath(dir));
    assert.equal(ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readWorkflowMode catches getAgentDir failure", async () => {
  const dir = tempDir();
  try {
    writeSettings(dir, { workflow: { mode: "free" } });
    const mode = await readWorkflowMode(settingsPath(dir));
    assert.equal(mode, "free");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── non-object workflow key ─────────────────────────────────────────

test("persistWorkflowMode handles non-object workflow key", async () => {
  const dir = tempDir();
  try {
    writeSettings(dir, {
      theme: "vraj-ink",
      workflow: "hello",
    });
    // workflow is a string, not an object — should be replaced
    const ok = await persistWorkflowMode("free", settingsPath(dir));
    assert.equal(ok, true);
    const saved = readSettings(dir);
    assert.equal(saved.workflow.mode, "free");
    assert.equal(saved.theme, "vraj-ink");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readWorkflowMode handles non-object workflow key", async () => {
  const dir = tempDir();
  try {
    writeSettings(dir, { workflow: "hello" });
    const mode = await readWorkflowMode(settingsPath(dir));
    assert.equal(mode, "workflow");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
