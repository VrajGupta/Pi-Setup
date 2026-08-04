type Execute = (command: string, args: string[]) => Promise<unknown>;

export async function notifyNative(
  title: string,
  body: string,
  platform: NodeJS.Platform,
  execute: Execute,
) {
  try {
    if (platform === "darwin") {
      const escape = (value: string) =>
        value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      await execute("osascript", [
        "-e",
        `display notification "${escape(body)}" with title "${escape(title)}"`,
      ]);
    } else if (platform === "linux") {
      await execute("notify-send", [title, body]);
    } else if (platform === "win32") {
      await execute("powershell", [
        "-NoProfile",
        "-Command",
        `New-BurntToastNotification -Text '${title.replace(/'/g, "''")}', '${body.replace(/'/g, "''")}'`,
      ]);
    }
  } catch {
    // Notifications are optional; the TUI and title remain authoritative.
  }
}
