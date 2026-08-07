#!/usr/bin/env node

import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const resourceNames = [
  "extensions",
  "skills",
  "themes",
  "SYSTEM.md",
  "keybindings.json",
  "node_modules",
];
const ponytail = "git:github.com/DietrichGebert/ponytail";

function parseArguments(args) {
  let agentDir;
  let dryRun = false;
  let forceCopy = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--agent-dir") {
      agentDir = args[++index];
      if (!agentDir) throw new Error("--agent-dir requires a path.");
    } else if (argument === "--dry-run") {
      dryRun = true;
    } else if (argument === "--force-copy") {
      forceCopy = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return { agentDir, dryRun, forceCopy };
}

function resources() {
  return resourceNames.map((name) => ({ name, source: join(root, name) }));
}

function requireCheckout() {
  for (const { name, source } of resources()) {
    if (name !== "node_modules" && !existsSync(source)) {
      throw new Error(
        `Refusing to install incomplete checkout; missing ${source}`,
      );
    }
  }
  if (
    !existsSync(join(root, "node_modules")) &&
    !existsSync(join(root, "package.json"))
  ) {
    throw new Error(
      `Refusing to install incomplete checkout; missing ${join(root, "package.json")}`,
    );
  }
}

function realpathWithMissingTail(path) {
  const missing = [];
  let existing = path;
  while (!lstatSync(existing, { throwIfNoEntry: false })) {
    missing.unshift(basename(existing));
    const parent = dirname(existing);
    if (parent === existing)
      throw new Error(`Cannot resolve install path: ${path}`);
    existing = parent;
  }
  return join(realpathSync(existing), ...missing);
}

function requireSafeTarget(targetDir) {
  const targetRelative = relative(root, realpathWithMissingTail(targetDir));
  const isInsideCheckout =
    targetRelative !== "" &&
    targetRelative !== ".." &&
    !targetRelative.startsWith(`..${sep}`) &&
    !isAbsolute(targetRelative);
  if (isInsideCheckout) {
    throw new Error(
      `Refusing to install into a path inside the checkout: ${targetDir}`,
    );
  }
}

function installDependencies(dryRun) {
  if (existsSync(join(root, "node_modules"))) return;
  if (dryRun) {
    console.log("Would install repository dependencies.");
    return;
  }

  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(
    command,
    ["install", "--ignore-scripts", "--prefix", root],
    {
      stdio: "inherit",
    },
  );
  if (result.status !== 0)
    throw new Error("Could not install repository dependencies.");
}

function readSettings(path) {
  if (!existsSync(path)) return {};

  let settings;
  try {
    settings = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`Refusing to overwrite malformed settings: ${path}`);
  }
  if (!settings || Array.isArray(settings) || typeof settings !== "object") {
    throw new Error(`Refusing to overwrite non-object settings: ${path}`);
  }
  if (
    "packages" in settings &&
    (!Array.isArray(settings.packages) ||
      !settings.packages.every(
        (entry) =>
          typeof entry === "string" ||
          (entry !== null &&
            !Array.isArray(entry) &&
            typeof entry === "object"),
      ))
  ) {
    throw new Error(
      `Refusing to overwrite malformed packages setting: ${path}`,
    );
  }
  return settings;
}

/**
 * PI-39: drop settings that only existed for the removed automatic workflow.
 * Every other key under `workflow` (trackerPollMs, statusWidget, repositories,
 * routines, subagentPicker) is preserved untouched, and re-running the
 * installer on already-migrated settings is a no-op.
 */
const OBSOLETE_WORKFLOW_KEYS = ["mode"];

function migrateWorkflowSettings(settings) {
  const workflow = settings.workflow;
  if (!workflow || typeof workflow !== "object" || Array.isArray(workflow))
    return {};
  if (!OBSOLETE_WORKFLOW_KEYS.some((key) => key in workflow)) return {};
  const kept = Object.fromEntries(
    Object.entries(workflow).filter(
      ([key]) => !OBSOLETE_WORKFLOW_KEYS.includes(key),
    ),
  );
  return { workflow: kept };
}

function mergeSettings(path, dryRun) {
  const settingsPath =
    existsSync(path) && lstatSync(path).isSymbolicLink()
      ? realpathSync(path)
      : path;
  const settings = readSettings(settingsPath);
  const packages = settings.packages ?? [];
  const next = {
    ...settings,
    ...migrateWorkflowSettings(settings),
    packages: [...packages.filter((entry) => entry !== ponytail), ponytail],
    theme: "vraj-ink",
    defaultProvider: "openai-codex",
    defaultModel: "gpt-5.6-sol",
    defaultThinkingLevel: "high",
    quietStartup: true,
    hideThinkingBlock: true,
    collapseChangelog: true,
    enableInstallTelemetry: false,
    steeringMode: "one-at-a-time",
    followUpMode: "one-at-a-time",
  };

  if (dryRun) {
    console.log(`Would update settings ${settingsPath}`);
    return;
  }

  mkdirSync(dirname(settingsPath), { recursive: true });
  const temporary = join(
    dirname(settingsPath),
    `.settings.${process.pid}.${Date.now()}.tmp`,
  );
  writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`);
  renameSync(temporary, settingsPath);
}

function createBackup(agentDir) {
  const backups = join(agentDir, "backups");
  mkdirSync(backups, { recursive: true });
  let backup = join(backups, `pi-agent-${Date.now()}-${process.pid}`);
  let suffix = 0;
  while (existsSync(backup))
    backup = join(backups, `pi-agent-${Date.now()}-${process.pid}-${++suffix}`);
  mkdirSync(backup);
  return backup;
}

function hasEntry(path) {
  return (
    existsSync(path) || Boolean(lstatSync(path, { throwIfNoEntry: false }))
  );
}

function isUnchanged(source, target) {
  return (
    existsSync(target) &&
    existsSync(source) &&
    realpathSync(source) === realpathSync(target)
  );
}

function createRollbackManifest(agentDir, backup) {
  const manifest = join(backup, ".rollback-manifest");
  const temporary = join(
    backup,
    `.rollback-manifest.tmp-${process.pid}-${Date.now()}`,
  );
  mkdirSync(temporary);
  for (const { name, source } of resources()) {
    const target = join(agentDir, name);
    const state = !hasEntry(target)
      ? "absent"
      : isUnchanged(source, target)
        ? "unchanged"
        : "present";
    writeFileSync(join(temporary, `${name}.${state}`), "");
  }
  renameSync(temporary, manifest);
}

function linkOrCopy(source, target, backup, forceCopy) {
  if (isUnchanged(source, target)) {
    return "unchanged";
  }

  const staged = join(
    dirname(target),
    `.${basename(target)}.pi-agent-${process.pid}-${Date.now()}`,
  );
  let copied = false;
  try {
    if (forceCopy) throw new Error("Simulated symlink failure.");
    symlinkSync(
      source,
      staged,
      process.platform === "win32" && lstatSync(source).isDirectory()
        ? "junction"
        : undefined,
    );
  } catch {
    copied = true;
  }
  if (copied) cpSync(source, staged, { recursive: true });

  if (existsSync(target) || lstatSync(target, { throwIfNoEntry: false })) {
    renameSync(target, join(backup, basename(target)));
  }
  renameSync(staged, target);
  return copied ? "copied" : "linked";
}

export function install({ agentDir, dryRun = false, forceCopy = false } = {}) {
  const configuredAgentDir = agentDir || process.env.PI_CODING_AGENT_DIR;
  const targetDir = resolve(
    configuredAgentDir || join(homedir(), ".pi", "agent"),
  );
  requireSafeTarget(targetDir);
  requireCheckout();
  installDependencies(dryRun);

  if (dryRun) {
    console.log(`Dry run: ${targetDir}`);
    for (const [index, { name, source }] of resources().entries()) {
      console.log(
        `Would ${forceCopy && index === 0 ? "copy" : "link"} ${source} -> ${join(targetDir, name)}`,
      );
    }
    mergeSettings(join(targetDir, "settings.json"), true);
    return;
  }

  mkdirSync(targetDir, { recursive: true });
  mergeSettings(join(targetDir, "settings.json"), false);
  const backup = createBackup(targetDir);
  createRollbackManifest(targetDir, backup);
  let simulateSymlinkFailure = forceCopy;
  for (const { name, source } of resources()) {
    const result = linkOrCopy(
      source,
      join(targetDir, name),
      backup,
      simulateSymlinkFailure,
    );
    simulateSymlinkFailure = false;
    if (result !== "unchanged")
      console.log(`${result === "copied" ? "Copied" : "Linked"} ${name}`);
  }
  console.log(`Installed Vraj Pi from ${root}`);
  console.log(`Backup: ${backup}`);
  console.log("Restart Pi or run /reload.");
}

try {
  install(parseArguments(process.argv.slice(2)));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
