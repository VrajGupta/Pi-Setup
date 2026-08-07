import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  cpSync,
  existsSync,
  lstatSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { resolvePickerEnabled } from "../subagents/src/picker-trigger.ts";
import { resolveStatusWidgetMaxLines } from "../ui-customization/status-widget-settings.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const installer = join(root, "install.sh");
const installerScript = join(root, "scripts", "install.mjs");
const setup = join(root, "SETUP.md");
const readme = join(root, "README.md");
const system = join(root, "SYSTEM.md");
const settingsExample = join(root, "settings.example.json");
const terseOutput = join(root, "skills", "terse-output", "SKILL.md");
const runtimeSettings = join(
  root,
  "node_modules/@earendil-works/pi-coding-agent/docs/settings.md",
);

function readSettings(path: string) {
  return JSON.parse(readFileSync(path, "utf8"));
}

test("PI-39: settings keys downArrow and maxLines parse and are consumed by their readers", () => {
  const settings = readSettings(settingsExample);
  const workflow = settings.workflow as {
    subagentPicker?: { downArrow?: unknown };
    statusWidget?: { maxLines?: unknown };
  };
  assert.ok(workflow?.subagentPicker, "workflow.subagentPicker missing");
  assert.equal(workflow.subagentPicker.downArrow, true);
  assert.ok(workflow?.statusWidget, "workflow.statusWidget missing");
  assert.equal(workflow.statusWidget.maxLines, 40);
  // The keys are consumed by the code that reads them, not just documented.
  assert.equal(resolvePickerEnabled(settings), true);
  assert.equal(resolveStatusWidgetMaxLines(settings), 40);
});

test("PI-39: README documents alt+down, maxLines, and the running-only DOWN gate", () => {
  const readmeText = readFileSync(readme, "utf8");
  assert.match(readmeText, /alt\+down/);
  assert.match(readmeText, /maxLines/);
  assert.match(readmeText, /only when a subagent is running/i);
  assert.match(
    readmeText,
    /DOWN opens the subagent picker only when a subagent is running/i,
  );
});

test("PI-39: SYSTEM.md keeps the picker as open-view-only with explicit in-view send (PI-11, INV-20)", () => {
  const systemText = readFileSync(system, "utf8");
  assert.match(systemText, /picker opens a view only/i);
  assert.match(systemText, /explicit in-view send action/i);
  assert.match(systemText, /\(PI-11, INV-20\)/);
});

test("settings document Pi's accepted steering values and describe direct-only operation", () => {
  const runtime = readFileSync(runtimeSettings, "utf8");
  assert.match(runtime, /`steeringMode`[\s\S]*`"all"` or `"one-at-a-time"`/);
  assert.equal(readSettings(settingsExample).steeringMode, "one-at-a-time");
  assert.deepEqual(readSettings(settingsExample).packages, [
    "git:github.com/DietrichGebert/ponytail",
  ]);
  assert.match(
    readFileSync(terseOutput, "utf8"),
    /Security warnings, irreversible action confirmations, and multi-step sequences are never compressed\./i,
  );
  const text = readFileSync(setup, "utf8");
  assert.match(text, /"all".*"one-at-a-time"/);
  assert.doesNotMatch(text, /workflow send|workflow start/i);
  // PI-39: the docs must describe direct-only operation, not a relay.
  assert.doesNotMatch(
    readFileSync(readme, "utf8"),
    /coordinator-mediated question relay|`\/flow` or \*\*F6\*\*/i,
  );
  assert.doesNotMatch(
    readFileSync(system, "utf8"),
    /workflow send|workflow start|route fleet|mode workflow/i,
  );
  assert.doesNotMatch(
    readFileSync(system, "utf8"),
    /question_batch: the workflow UI relays/i,
  );
  for (const path of [readme, system]) {
    const contents = readFileSync(path, "utf8");
    // PI-39: no relay wording may survive in the active docs.
    assert.doesNotMatch(contents, /workflow send|workflow start/);
    assert.match(contents, /Ponytail/i);
    assert.match(contents, /Caveman/i);
    assert.match(
      contents,
      /Security warnings, irreversible action confirmations, and multi-step sequences are never compressed\./i,
    );
  }
  for (const path of [
    installer,
    settingsExample,
    terseOutput,
    readme,
    system,
  ]) {
    assert.doesNotMatch(
      readFileSync(path, "utf8"),
      /(?:sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|AKIA[0-9A-Z]{16}|Bearer\s+[A-Za-z0-9._~+/=-]{20,})/,
    );
  }
});

test("installer replaces legacy all steering mode and is idempotent", () => {
  const temporary = mkdtempSync(join(tmpdir(), "pi-agent-config-"));
  const agentDir = join(temporary, "agent with spaces");
  const settings = join(agentDir, "settings.json");
  mkdirSync(agentDir);
  writeFileSync(
    settings,
    JSON.stringify({
      steeringMode: "all",
      preserved: true,
      packages: [
        "npm:example",
        { source: "pi-skills", skills: ["brave-search"] },
        "npm:例子-🧪;$(touch SHOULD_NOT_EXIST)",
        "git:github.com/DietrichGebert/ponytail",
        "git:github.com/DietrichGebert/ponytail",
      ],
    }),
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
    assert.deepEqual(once.packages, [
      "npm:example",
      { source: "pi-skills", skills: ["brave-search"] },
      "npm:例子-🧪;$(touch SHOULD_NOT_EXIST)",
      "git:github.com/DietrichGebert/ponytail",
    ]);
    assert.equal(lstatSync(join(agentDir, "skills")).isSymbolicLink(), true);
    assert.match(
      readFileSync(
        join(agentDir, "skills", "terse-output", "SKILL.md"),
        "utf8",
      ),
      /safety exceptions/i,
    );

    for (let run = 0; run < 3; run += 1) install();
    assert.deepEqual(readSettings(settings), once);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("installer refuses malformed settings without overwriting them", () => {
  const temporary = mkdtempSync(join(tmpdir(), "pi-agent-malformed-"));
  const agentDir = join(temporary, "agent");
  const settings = join(agentDir, "settings.json");
  const original = '{"steeringMode": "all"';
  mkdirSync(agentDir);
  writeFileSync(settings, original);

  try {
    assert.throws(() =>
      execFileSync("bash", [installer], {
        cwd: root,
        env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
        stdio: "pipe",
      }),
    );
    assert.equal(readFileSync(settings, "utf8"), original);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("installer refuses non-object settings without overwriting them", () => {
  const temporary = mkdtempSync(join(tmpdir(), "pi-agent-non-object-"));
  const agentDir = join(temporary, "agent");
  const settings = join(agentDir, "settings.json");
  mkdirSync(agentDir);

  try {
    for (const original of ["null", "[]", "42", '"settings"']) {
      writeFileSync(settings, original);
      assert.throws(() =>
        execFileSync("bash", [installer], {
          cwd: root,
          env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
          stdio: "pipe",
        }),
      );
      assert.equal(readFileSync(settings, "utf8"), original);
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("installer refuses malformed package settings without overwriting them", () => {
  const temporary = mkdtempSync(join(tmpdir(), "pi-agent-packages-"));
  const agentDir = join(temporary, "agent");
  const settings = join(agentDir, "settings.json");
  mkdirSync(agentDir);

  try {
    for (const value of [{ custom: true }, ["npm:example", null]]) {
      const original = JSON.stringify({ packages: value });
      writeFileSync(settings, original);
      assert.throws(() =>
        execFileSync("bash", [installer], {
          cwd: root,
          env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
          stdio: "pipe",
        }),
      );
      assert.equal(readFileSync(settings, "utf8"), original);
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("installer updates a symlinked settings target without replacing the link", () => {
  const temporary = mkdtempSync(join(tmpdir(), "pi-agent-settings-link-"));
  const agentDir = join(temporary, "agent");
  const target = join(temporary, "settings-target.json");
  const settings = join(agentDir, "settings.json");
  mkdirSync(agentDir);
  writeFileSync(target, JSON.stringify({ packages: ["npm:example"] }));
  symlinkSync(target, settings);

  try {
    execFileSync("bash", [installer], {
      cwd: root,
      env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
      stdio: "pipe",
    });
    assert.equal(lstatSync(settings).isSymbolicLink(), true);
    assert.deepEqual(readSettings(target).packages, [
      "npm:example",
      "git:github.com/DietrichGebert/ponytail",
    ]);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("installer leaves an in-place repository's resources intact", () => {
  const temporary = mkdtempSync(join(tmpdir(), "pi-agent-in-place-"));
  const repository = join(temporary, "repo");
  const settings = join(repository, "settings.json");
  mkdirSync(join(repository, "node_modules"), { recursive: true });
  mkdirSync(join(repository, "extensions"));
  mkdirSync(join(repository, "skills"));
  mkdirSync(join(repository, "themes"));
  mkdirSync(join(repository, "scripts"));
  cpSync(installer, join(repository, "install.sh"));
  cpSync(installerScript, join(repository, "scripts", "install.mjs"));
  cpSync(join(root, "SYSTEM.md"), join(repository, "SYSTEM.md"));
  cpSync(join(root, "keybindings.json"), join(repository, "keybindings.json"));
  writeFileSync(settings, JSON.stringify({ steeringMode: "all" }));

  try {
    execFileSync("bash", [join(repository, "install.sh")], {
      cwd: repository,
      env: { ...process.env, PI_CODING_AGENT_DIR: repository },
      stdio: "pipe",
    });
    assert.equal(readSettings(settings).steeringMode, "one-at-a-time");
    for (const name of [
      "node_modules",
      "extensions",
      "skills",
      "themes",
      "SYSTEM.md",
      "keybindings.json",
    ]) {
      assert.equal(
        lstatSync(join(repository, name)).isSymbolicLink(),
        false,
        name,
      );
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("installer refuses an incomplete checkout before changing settings", () => {
  const temporary = mkdtempSync(join(tmpdir(), "pi-agent-incomplete-"));
  const repository = join(temporary, "repo");
  const agentDir = join(temporary, "agent");
  const settings = join(agentDir, "settings.json");
  mkdirSync(join(repository, "node_modules"), { recursive: true });
  mkdirSync(join(repository, "extensions"));
  mkdirSync(join(repository, "themes"));
  mkdirSync(agentDir);
  mkdirSync(join(repository, "scripts"));
  cpSync(installer, join(repository, "install.sh"));
  cpSync(installerScript, join(repository, "scripts", "install.mjs"));
  writeFileSync(join(repository, "SYSTEM.md"), "system");
  writeFileSync(join(repository, "keybindings.json"), "{}");
  const original = JSON.stringify({ packages: ["npm:example"] });
  writeFileSync(settings, original);

  try {
    assert.throws(() =>
      execFileSync("bash", [join(repository, "install.sh")], {
        cwd: repository,
        env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
        stdio: "pipe",
      }),
    );
    assert.equal(readFileSync(settings, "utf8"), original);
    assert.equal(existsSync(join(agentDir, "skills")), false);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
