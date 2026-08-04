import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
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
const installer = join(root, "scripts", "install.mjs");
const setup = join(root, "SETUP.md");
const resources = [
  "node_modules",
  "extensions",
  "skills",
  "themes",
  "SYSTEM.md",
  "keybindings.json",
];

function runInstaller(args: string[]) {
  const result = spawnSync(process.execPath, [installer, ...args], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test("installer dry-run reports every resource without creating its agent directory", () => {
  const temporary = join(
    tmpdir(),
    `pi-agent-dry-run-${process.pid}-${Date.now()}`,
  );

  try {
    const output = runInstaller(["--dry-run", "--agent-dir", temporary]);
    assert.equal(existsSync(temporary), false);
    for (const resource of resources)
      assert.match(output, new RegExp(`Would link .*${resource}`));
    const setupText = readFileSync(setup, "utf8");
    assert.match(setupText, /\.\\install\.ps1/);
    assert.match(
      setupText,
      /bin\/fd.*platform-specific.*never a committed binary/i,
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("installer is idempotent and its forced symlink failure copies resources", () => {
  const temporary = join(
    tmpdir(),
    `pi-agent-install-${process.pid}-${Date.now()}`,
  );
  const agentDir = join(temporary, "agent with spaces");
  const fallbackDir = join(temporary, "copy fallback");

  try {
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      join(agentDir, "settings.json"),
      JSON.stringify({ preserved: true, packages: ["npm:user-package"] }),
    );
    runInstaller(["--agent-dir", agentDir]);
    const once = readFileSync(join(agentDir, "settings.json"), "utf8");
    runInstaller(["--agent-dir", agentDir]);
    assert.equal(readFileSync(join(agentDir, "settings.json"), "utf8"), once);
    assert.deepEqual(JSON.parse(once).packages, [
      "npm:user-package",
      "git:github.com/DietrichGebert/ponytail",
    ]);

    const output = runInstaller(["--force-copy", "--agent-dir", fallbackDir]);
    assert.match(output, /Copied extensions/);
    assert.equal(
      lstatSync(join(fallbackDir, "extensions")).isSymbolicLink(),
      false,
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
