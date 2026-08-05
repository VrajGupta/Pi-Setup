import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import workflowExtension from "./index.ts";
import {
  classifyRequest,
  parseControlEnvelope,
  type WorkflowMode,
} from "./src/policy.ts";

test("routes high-risk work into planner", () => {
  const route = classifyRequest(
    "Add a payment webhook with idempotent retries",
  );
  assert.equal(route.mode, "fleet");
  assert.equal(route.stage, "planner");
  assert.equal(route.confidence, "high");
  assert.deepEqual(route.skills, ["provider-integration-tdd"]);
});

test("main-chat input remains orchestrator-only while workflow relay checks identity", () => {
  const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /pi\.on\(\s*["']input["']/);
  // /mode handler uses ctx.ui.select for the mode picker, not for routing user input
  assert.doesNotMatch(source, /ctx\.ui\.input\(/);
  assert.doesNotMatch(source, /canSteerStage/);
  assert.match(
    source,
    /if \(input\.action === "send"\)[\s\S]*await sendToStage\(input\.id, input\.text\)/,
  );
  assert.match(
    source,
    /const sendToStage = async \(id: string, text: string\) => \{[\s\S]*state\.stageAgentId !== id[\s\S]*active workflow stage/,
  );
  assert.match(source, /Human messages always go to the orchestrator/);
});

test("keeps explanations on the direct path", () => {
  const route = classifyRequest("Explain how the session tree works");
  assert.equal(route.mode, "direct");
  assert.equal(route.stage, null);
});

test("respects explicit stage requests", () => {
  const route = classifyRequest("Run debugger against this diff");
  assert.equal(route.stage, "debugger");
  assert.equal(route.confidence, "high");
});

test("extracts a control envelope from wrapped stage output", () => {
  const envelope = parseControlEnvelope(
    'Subagent finished.\n\n{"kind":"blocked","stage":"coder","reason":"gate is red","recovery":"fix test"}',
  );
  assert.deepEqual(envelope, {
    kind: "blocked",
    stage: "coder",
    reason: "gate is red",
    recovery: "fix test",
  });
});

test("rejects malformed control JSON", () => {
  assert.equal(parseControlEnvelope('{"kind":"stage_complete"}'), null);
});

test("free mode routes risky/broad prompts direct unless a stage is named", () => {
  const risky = classifyRequest(
    "Add a payment webhook with idempotent retries",
    "free",
  );
  assert.equal(risky.mode, "direct");
  assert.equal(risky.stage, null);
  const broad = classifyRequest(
    "Build an end-to-end feature across modules",
    "free",
  );
  assert.equal(broad.mode, "direct");
  assert.equal(broad.stage, null);
  const staged = classifyRequest("Run coder against this diff", "free");
  assert.equal(staged.mode, "fleet");
  assert.equal(staged.stage, "coder");
  const legacy = classifyRequest("part3 please", "free");
  assert.equal(legacy.mode, "fleet");
  assert.equal(legacy.stage, "debugger");
});

test("workflow mode is the default and matches current routing", () => {
  const risky = classifyRequest(
    "Add a payment webhook with idempotent retries",
  );
  assert.equal(risky.mode, "fleet");
  assert.equal(risky.stage, "planner");
  const small = classifyRequest("Sort a list of names");
  assert.equal(small.mode, "direct");
  assert.equal(small.stage, null);
  for (const invalid of [
    "free-mode",
    "fleet",
    "",
    null,
    "FREE",
    " free ",
  ] as unknown[]) {
    const route = classifyRequest(
      "Add a payment webhook",
      invalid as WorkflowMode,
    );
    assert.equal(route.mode, "fleet");
    assert.equal(route.stage, "planner");
  }
});

test("free mode ignores stage mentions in prose but accepts explicit stage commands", () => {
  for (const prompt of [
    "This document describes the planner stage.",
    "planner stage is mentioned here, not requested.",
    "The coder and reviewer stages are mentioned here, not requested.",
    "part1-4 are legacy aliases.",
    "part 1-4 are legacy aliases.",
    "/part1-4 is documented here.",
    "part3 is a legacy alias, not a request.",
    "part1 is a legacy alias, not a request.",
    "The /planner command is documented here.",
    "/plannerish is not a stage command.",
    "Do not use the planner; just explain this.",
  ]) {
    const route = classifyRequest(prompt, "free");
    assert.equal(route.mode, "direct", prompt);
    assert.equal(route.stage, null, prompt);
  }

  for (const [prompt, stage] of [
    ["/planner fix this", "planner"],
    ["Please use /planner for this task", "planner"],
    ["Please use reviewer for this task", "reviewer"],
    ["Run debugger against this diff", "debugger"],
    ["part 2 please", "coder"],
    ["/part4 review this", "reviewer"],
  ] as const) {
    const route = classifyRequest(prompt, "free");
    assert.equal(route.mode, "fleet", prompt);
    assert.equal(route.stage, stage, prompt);
  }
});

test("documents both routing modes and ships the workflow default", () => {
  const settings = JSON.parse(
    readFileSync(
      new URL("../../settings.example.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(settings.workflow.mode, "workflow");

  for (const path of ["../../SYSTEM.md", "../../README.md"]) {
    const contents = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.match(contents, /workflow\.mode/);
    assert.match(contents, /"workflow"/);
    assert.match(contents, /"free"/);
    assert.match(contents, /explicit[^.\n]*stage/i);
    assert.equal(
      (
        contents.match(
          /mode (?:only changes routing|changes routing only), never authz or data exposure(?: \(INV-8\))?\./gi,
        ) ?? []
      ).length,
      1,
    );
  }
});

test("mode changes routing only, never exposes prompt text (INV-8)", () => {
  const secret = "sk-live-abcdefghijklmnopqrstuvwx";
  const prompt = `migrate the production database using ${secret}`;
  for (const mode of ["workflow", "free"] as const) {
    const decision = classifyRequest(prompt, mode);
    assert.equal(decision.mode, mode === "workflow" ? "fleet" : "direct");
    assert.ok(
      !JSON.stringify(decision).includes(secret),
      `${mode} mode leaked prompt text`,
    );
  }
});

test("the mode command validates, changes only live state, and wires every route seam", async () => {
  type Command = (
    args: unknown,
    ctx: { ui: { notify(message: string, type?: string): void } },
  ) => Promise<void>;
  type WorkflowTool = {
    execute: (...args: unknown[]) => Promise<unknown>;
  };
  const commands = new Map<string, Command>();
  const emitted: string[] = [];
  let workflowTool: WorkflowTool | undefined;
  const pi = {
    on() {},
    registerCommand(name: string, options: { handler: Command }) {
      commands.set(name, options.handler);
    },
    registerShortcut() {},
    registerTool(tool: WorkflowTool & { name: string }) {
      if (tool.name === "workflow") workflowTool = tool;
    },
    events: {
      on() {
        return () => {};
      },
      emit(channel: string) {
        emitted.push(channel);
      },
    },
  };

  workflowExtension(pi as never);
  const command = commands.get("mode");
  assert.ok(command);
  const tool = workflowTool;
  assert.ok(tool);
  const notifications: [string, string | undefined][] = [];
  const commandContext = {
    ui: {
      notify(message: string, type?: string) {
        notifications.push([message, type]);
      },
      select() {
        return undefined; // cancelling, no mode change
      },
    },
  };
  const route = async () => {
    const result = await tool.execute(
      "route",
      {
        action: "route",
        prompt: "Add a payment webhook with idempotent retries",
      },
      undefined,
      () => {},
      {},
    );
    return (result as { details: { mode: string } }).details.mode;
  };

  assert.equal(await route(), "fleet");
  // Bare mode → picker → cancelled → no notification, mode unchanged
  for (const invalid of ["", "   ", undefined]) {
    const prev = notifications.length;
    await command(invalid as unknown as string, commandContext);
    assert.equal(notifications.length, prev);
    assert.equal(await route(), "fleet");
  }
  // Invalid value → warning notification, mode unchanged
  {
    const prev = notifications.length;
    await command("free-mode", commandContext);
    assert.equal(notifications.length, prev + 1);
    assert.equal(notifications.at(-1)?.[1], "warning");
    assert.equal(await route(), "fleet");
  }
  await command(" FREE ", commandContext);
  assert.equal(await route(), "direct");
  assert.match(notifications.at(-1)?.[0] ?? "", /mode free \(manual\)/);
  await command("WORKFLOW", commandContext);
  assert.equal(await route(), "fleet");
  assert.match(notifications.at(-1)?.[0] ?? "", /mode workflow/);
  assert.equal(emitted.includes("vraj:subagent-bridge"), false);

  const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.equal(
    [...source.matchAll(/classifyRequest\(([^\n]*)\)/g)].filter(
      ([, args]) => !args.includes(", mode"),
    ).length,
    0,
  );
});

test("session start uses the configured default instead of persisted live mode", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pi19-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = directory;
  try {
    mkdirSync(join(directory, "workflows"));
    writeFileSync(
      join(directory, "settings.json"),
      JSON.stringify({
        workflow: { mode: "workflow", repositories: [directory] },
      }),
    );
    writeFileSync(
      join(directory, "workflows", "repo.json"),
      JSON.stringify({ status: "running", mode: "free" }),
    );

    const states: Record<string, unknown>[] = [];
    const hooks = new Map<string, (...args: unknown[]) => unknown>();
    const pi = {
      on(event: string, handler: (...args: unknown[]) => unknown) {
        hooks.set(event, handler);
      },
      registerCommand() {},
      registerShortcut() {},
      registerTool() {},
      events: {
        on() {
          return () => {};
        },
        emit(channel: string, value: unknown) {
          if (channel === "vraj:workflow-state")
            states.push(value as Record<string, unknown>);
        },
      },
    };
    workflowExtension(pi as never);
    await hooks.get("session_start")?.({}, { mode: "tui", cwd: "/repo" });

    assert.equal(states.at(-1)?.mode, "workflow");
    assert.equal(states.at(-1)?.status, "recoverable");
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    rmSync(directory, { recursive: true, force: true });
  }
});
