import assert from "node:assert/strict";
import test from "node:test";
import { notifyNative } from "./notify-native.ts";

test("native notifications degrade when every platform notifier is unavailable", async () => {
  const calls: string[] = [];
  const unavailable = async (command: string) => {
    calls.push(command);
    throw new Error("not installed");
  };

  for (const platform of ["darwin", "linux", "win32", "freebsd"] as const) {
    await assert.doesNotReject(() =>
      notifyNative("title", "body", platform, unavailable),
    );
  }
  assert.deepEqual(calls, ["osascript", "notify-send", "powershell"]);
});
