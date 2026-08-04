import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const installer = join(root, "install.sh");
const setup = join(root, "SETUP.md");
const readme = join(root, "README.md");
const system = join(root, "SYSTEM.md");
const settingsExample = join(root, "settings.example.json");
const runtimeSettings = join(
  root,
  "node_modules/@earendil-works/pi-coding-agent/docs/settings.md",
);

function readSettings(path: string) {
  return JSON.parse(readFileSync(path, "utf8"));
}

test("settings document Pi's accepted steering values and keep stages on relay", () => {
  const runtime = readFileSync(runtimeSettings, "utf8");
  assert.match(runtime, /`steeringMode`[\s\S]*`"all"` or `"one-at-a-time"`/);
  assert.equal(readSettings(settingsExample).steeringMode, "one-at-a-time");
  const text = readFileSync(setup, "utf8");
  assert.match(text, /"all".*"one-at-a-time"/);
  assert.match(text, /orchestrator.*workflow send/i);
  for (const path of [readme, system]) {
    assert.match(
      readFileSync(path, "utf8"),
      /Vraj messages only the coordinator[\s\S]*workflow send/,
    );
  }
});

test("installer replaces legacy all steering mode and is idempotent", () => {
  const temporary = mkdtempSync(join(tmpdir(), "pi-agent-config-"));
  const agentDir = join(temporary, "agent");
  const settings = join(agentDir, "settings.json");
  mkdirSync(agentDir);
  writeFileSync(
    settings,
    JSON.stringify({ steeringMode: "all", preserved: true }),
  );

  try {
    const install = () =>
      execFileSync("bash", [installer], {
        cwd: root,
        env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
        stdio: "pipe",
      });

    install();
    const once = readSettings(settings);
    assert.equal(once.steeringMode, "one-at-a-time");
    assert.equal(once.preserved, true);

    install();
    assert.deepEqual(readSettings(settings), once);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
