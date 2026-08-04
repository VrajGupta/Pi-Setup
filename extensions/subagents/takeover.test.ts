import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  reconcileDashboardSelection,
  type DashboardSelection,
} from "./src/ui/takeover.ts";

test("workflow stage takeovers never accept typed text", () => {
  const source = readFileSync(
    new URL("./src/ui/takeover.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /this\.input\.onSubmit = \(value: string\) => \{[\s\S]*if \(this\.snap\(\)\?\.stage\) return;[\s\S]*requestSend/,
  );
  assert.match(
    source,
    /if \(this\.snap\(\)\?\.stage\) return;\s*this\.input\.handleInput\(data\)/,
  );
  assert.match(source, /Vraj messages only the coordinator/);
  const tools = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.match(
    tools,
    /if \(snap\.stage\)[\s\S]*throw new Error\([\s\S]*"Workflow stages accept messages only through workflow send\."/,
  );
});

test("dashboard selection follows its subagent id and falls back by row", () => {
  const selection: DashboardSelection = { id: "sa-7", index: 6 };

  reconcileDashboardSelection(selection, [
    { id: "sa-new" },
    ...Array.from({ length: 8 }, (_, index) => ({ id: `sa-${index + 1}` })),
  ]);
  assert.deepEqual(selection, { id: "sa-7", index: 7 });

  reconcileDashboardSelection(selection, [
    ...Array.from({ length: 6 }, (_, index) => ({ id: `sa-${index + 1}` })),
    { id: "sa-8" },
    { id: "sa-9" },
  ]);
  assert.deepEqual(selection, { id: "sa-9", index: 7 });

  reconcileDashboardSelection(selection, [{ id: "sa-1" }, { id: "sa-2" }]);
  assert.deepEqual(selection, { id: "sa-2", index: 1 });

  reconcileDashboardSelection(selection, []);
  assert.deepEqual(selection, { id: undefined, index: 0 });
});
