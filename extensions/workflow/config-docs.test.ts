import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  cpSync,
  lstatSync,
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
const terseOutput = join(root, "skills", "terse-output", "SKILL.md");
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
  assert.deepEqual(readSettings(settingsExample).packages, [
    "git:github.com/DietrichGebert/ponytail",
  ]);
  assert.match(readFileSync(terseOutput, "utf8"), /safety exceptions/i);
  const text = readFileSync(setup, "utf8");
  assert.match(text, /"all".*"one-at-a-time"/);
  assert.match(text, /orchestrator.*workflow send/i);
  assert.match(
    readFileSync(readme, "utf8"),
    /coordinator-mediated question relay/i,
  );
  assert.match(
    readFileSync(system, "utf8"),
    /question_batch.*coordinator.*workflow send/i,
  );
  assert.doesNotMatch(
    readFileSync(system, "utf8"),
    /question_batch: the workflow UI relays/i,
  );
  for (const path of [readme, system]) {
    const contents = readFileSync(path, "utf8");
    assert.match(
      contents,
      /Vraj messages only the coordinator[\s\S]*workflow send/,
    );
    assert.match(contents, /Ponytail/i);
    assert.match(contents, /Caveman/i);
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

test("installer leaves an in-place repository's resources intact", () => {
  const temporary = mkdtempSync(join(tmpdir(), "pi-agent-in-place-"));
  const repository = join(temporary, "repo");
  const settings = join(repository, "settings.json");
  mkdirSync(join(repository, "node_modules"), { recursive: true });
  mkdirSync(join(repository, "extensions"));
  mkdirSync(join(repository, "themes"));
  cpSync(installer, join(repository, "install.sh"));
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
