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
import { persistWorkflowMode, readWorkflowMode } from "./settings-mode.ts";

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
