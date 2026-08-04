import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const installer = join(root, "scripts", "install.mjs");
const setup = join(root, "SETUP.md");
const resources = [
  "extensions",
  "skills",
  "themes",
  "SYSTEM.md",
  "keybindings.json",
  "node_modules",
];
const directories = new Set(["extensions", "skills", "themes", "node_modules"]);

function seedResource(agentDir, name) {
  const target = join(agentDir, name);
  const original = Buffer.from(`original ${name}\n\0bytes`, "utf8");
  if (directories.has(name)) {
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "original.bin"), original);
  } else {
    writeFileSync(target, original);
  }
  return original;
}

function readResource(agentDir, name) {
  return readFileSync(
    directories.has(name)
      ? join(agentDir, name, "original.bin")
      : join(agentDir, name),
  );
}

test("install backup can be listed and rolled back byte-for-byte without a real home", () => {
  const temporary = mkdtempSync(join(tmpdir(), "pi-agent-rollback-"));
  const agentDir = join(temporary, "agent");
  mkdirSync(agentDir);
  const originals = new Map(resources.map((name) => [name, seedResource(agentDir, name)]));

  try {
    const output = execFileSync(
      process.execPath,
      [installer, "--agent-dir", agentDir],
      { cwd: root, encoding: "utf8" },
    );
    const backup = output.match(/^Backup: (.+)$/m)?.[1];
    assert.ok(backup);
    assert.equal(backup.startsWith(join(agentDir, "backups", "pi-agent-")), true);
    assert.deepEqual(resources.filter((name) => existsSync(join(backup, name))), resources);

    for (const name of resources) {
      rmSync(join(agentDir, name), { recursive: true, force: true });
      renameSync(join(backup, name), join(agentDir, name));
      assert.deepEqual(readResource(agentDir, name), originals.get(name));
    }

    const text = readFileSync(setup, "utf8");
    assert.match(text, /## Backup and rollback/);
    assert.match(text, /\.pi[/\\]agent[/\\]backups[/\\]pi-agent-/);
    assert.match(text, /settings\.json.*\.env.*auth.*models.*sessions/is);
    assert.match(
      text,
      /git fetch origin[\s\S]*git rev-parse HEAD[\s\S]*git rev-parse "origin\/\$branch"/,
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
