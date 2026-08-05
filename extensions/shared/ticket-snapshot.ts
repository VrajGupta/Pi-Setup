export const TICKET_STATUSES = [
  "planned",
  "agent-ready",
  "coding",
  "debugger-ready",
  "debugging",
  "review-ready",
  "reviewing",
  "done",
  "dropped",
  "canceled",
  "duplicate",
  "unknown",
] as const;

export type TicketStatus = (typeof TICKET_STATUSES)[number];
export type TicketAssignee = "planner" | "coder" | "debugger" | "reviewer";

export interface TicketBlocker {
  readonly id: string;
  readonly satisfied: boolean;
}

export type TicketBlocking = "unblocked" | "blocked" | "blocked (cycle)";

export type TicketEta =
  | { readonly kind: "unknown" }
  | {
      readonly kind: "estimated";
      readonly minMs: number;
      readonly maxMs: number;
      readonly n: number;
    };

export interface TicketRecord {
  readonly repo: string;
  readonly id: string;
  readonly title: string;
  readonly status: TicketStatus;
  readonly blockedBy: readonly TicketBlocker[];
  readonly blocking: TicketBlocking;
  readonly assignee?: TicketAssignee;
  readonly verificationCommand?: string;
  readonly updatedAt?: number;
  readonly measuredStageDurationMs?: number;
  readonly eta: TicketEta;
}

export interface TicketSnapshot {
  readonly repo: string;
  readonly capturedAt: number;
  readonly records: readonly TicketRecord[];
  readonly reason?: string;
}

export interface TicketSnapshotCapture {
  readonly repo: string;
  readonly capturedAt: number;
}

type ParsedTicket = Omit<TicketRecord, "blockedBy" | "blocking" | "eta"> & {
  readonly blockerIds: readonly string[];
};

const STATUS_BY_TEXT: Readonly<Record<string, TicketStatus>> = {
  planned: "planned",
  "agent ready": "agent-ready",
  coding: "coding",
  "debugger ready": "debugger-ready",
  debugging: "debugging",
  "review ready": "review-ready",
  reviewing: "reviewing",
  done: "done",
  dropped: "dropped",
  canceled: "canceled",
  duplicate: "duplicate",
};

const ROLE_BY_STATUS: Readonly<Partial<Record<TicketStatus, TicketAssignee>>> =
  {
    planned: "planner",
    "agent-ready": "coder",
    coding: "coder",
    "debugger-ready": "debugger",
    debugging: "debugger",
    "review-ready": "reviewer",
    reviewing: "reviewer",
    done: "reviewer",
  };

function freeze<T>(value: T): Readonly<T> {
  return Object.freeze(value);
}

function maskFencedCode(markdown: string) {
  let fenced = false;
  let fenceChar = "";
  let fenceLength = 0;

  return markdown
    .split("\n")
    .map((line) => {
      const marker = line.match(/^\s*(`{3,}|~{3,})/)?.[1];
      const closing = line.match(/^\s*(`{3,}|~{3,})\s*$/)?.[1];
      if (fenced) {
        if (
          closing &&
          closing[0] === fenceChar &&
          closing.length >= fenceLength
        ) {
          fenced = false;
          fenceChar = "";
          fenceLength = 0;
        }
        return line.replace(/[^\r]/g, " ");
      }
      if (marker) {
        fenced = true;
        fenceChar = marker[0]!;
        fenceLength = marker.length;
        return line.replace(/[^\r]/g, " ");
      }
      return line;
    })
    .join("\n");
}

function statusFrom(section: string): TicketStatus {
  const text = section.match(/^Status:\s*\*\*([^*]+)\*\*(?:\s*(?:·|$))/m)?.[1];
  return text
    ? (STATUS_BY_TEXT[text.trim().toLowerCase()] ?? "unknown")
    : "unknown";
}

function assigneeFrom(text: string | undefined, status: TicketStatus) {
  const value = text?.trim().toLowerCase();
  if (
    value === "planner" ||
    value === "coder" ||
    value === "debugger" ||
    value === "reviewer"
  ) {
    return value;
  }
  return ROLE_BY_STATUS[status];
}

function field(section: string, name: string): string | undefined {
  const match = section.match(
    new RegExp(
      `(?:^|\\n|^Status:[^\\n]*·\\s*)${name}:\\s*\\**([^\\n*·]+)`,
      "im",
    ),
  );
  return match?.[1]?.trim();
}

function blockerIds(section: string): readonly string[] {
  const value = field(section, "Blocked-by");
  if (!value || /^none\b/i.test(value)) return freeze([]);
  return freeze([...new Set(value.match(/PI-\d+/g) ?? [])]);
}

function timestamp(section: string): number | undefined {
  const value = field(section, "Updated(?:-at)?");
  if (!value) return undefined;
  const parsed = /^\d+$/.test(value) ? Number(value) : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function measuredStageDuration(section: string): number | undefined {
  const value = field(section, "Measured-stage-duration-ms");
  if (!value || !/^\d+(?:_\d+)*$/.test(value)) return undefined;
  const duration = Number(value.replaceAll("_", ""));
  return Number.isSafeInteger(duration) && duration > 0 ? duration : undefined;
}

function parseVerificationCommand(section: string): string | undefined {
  return section.match(/\*\*Verification-command\.\*\*\s*`([^`\n]+)`/i)?.[1];
}

function cycleIds(
  records: readonly ParsedTicket[],
  byId: ReadonlyMap<string, ParsedTicket>,
): ReadonlySet<string> {
  const state = new Map<string, "visiting" | "done">();
  const cycles = new Set<string>();

  for (const root of records) {
    if (state.has(root.id)) continue;
    const stack: { id: string; next: number }[] = [{ id: root.id, next: 0 }];
    const path: string[] = [root.id];
    const positions = new Map([[root.id, 0]]);
    state.set(root.id, "visiting");

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const record = byId.get(frame.id);
      const nextId = record?.blockerIds[frame.next++];
      if (!nextId) {
        state.set(frame.id, "done");
        positions.delete(frame.id);
        path.pop();
        stack.pop();
        continue;
      }
      if (!byId.has(nextId) || state.get(nextId) === "done") continue;
      const position = positions.get(nextId);
      if (position !== undefined) {
        for (const id of path.slice(position)) cycles.add(id);
        continue;
      }
      state.set(nextId, "visiting");
      positions.set(nextId, path.length);
      path.push(nextId);
      stack.push({ id: nextId, next: 0 });
    }
  }

  return cycles;
}

function uniqueRecordsById(records: readonly ParsedTicket[]) {
  const counts = new Map<string, number>();
  for (const record of records) {
    counts.set(record.id, (counts.get(record.id) ?? 0) + 1);
  }
  return new Map(
    records
      .filter((record) => counts.get(record.id) === 1)
      .map((record) => [record.id, record]),
  );
}

function etaFrom(records: readonly ParsedTicket[]): TicketEta {
  const samples = records.flatMap((record) =>
    record.status === "done" && record.measuredStageDurationMs
      ? [record.measuredStageDurationMs]
      : [],
  );
  if (samples.length < 3) return freeze({ kind: "unknown" as const });
  return freeze({
    kind: "estimated" as const,
    minMs: Math.min(...samples),
    maxMs: Math.max(...samples),
    n: samples.length,
  });
}

/** Parses an already-read tracker; capture time is supplied by the off-render caller. */
export function parseTicketSnapshot(
  tracker: string,
  capture: TicketSnapshotCapture,
): TicketSnapshot {
  const base = { repo: capture.repo, capturedAt: capture.capturedAt };
  if (!tracker.trim())
    return freeze({ ...base, records: freeze([]), reason: "empty tracker" });

  const searchableTracker = maskFencedCode(tracker);
  const headings = [
    ...searchableTracker.matchAll(/^## (PI-\d+) — (.+?)\s*$/gm),
  ];
  if (headings.length === 0) {
    return freeze({
      ...base,
      records: freeze([]),
      reason: "no complete ticket headings",
    });
  }

  const parsed = headings.map((heading, index) => {
    const section = searchableTracker.slice(
      heading.index,
      headings[index + 1]?.index ?? tracker.length,
    );
    const status = statusFrom(section);
    const explicitAssignee = field(section, "Assignee")?.replace(
      /^\*+|\*+$/g,
      "",
    );
    const verificationCommand = parseVerificationCommand(section);
    const updatedAt = timestamp(section);
    const duration = measuredStageDuration(section);
    return {
      repo: capture.repo,
      id: heading[1],
      title: heading[2].replace(/~~/g, ""),
      status,
      blockerIds: blockerIds(section),
      assignee: assigneeFrom(explicitAssignee, status),
      ...(verificationCommand ? { verificationCommand } : {}),
      ...(updatedAt === undefined ? {} : { updatedAt }),
      ...(duration === undefined ? {} : { measuredStageDurationMs: duration }),
    } satisfies ParsedTicket;
  });
  const byId = uniqueRecordsById(parsed);
  const cycles = cycleIds(parsed, byId);
  const eta = etaFrom([...byId.values()]);
  const records = freeze(
    parsed.map((record) => {
      const blockedBy = freeze(
        record.blockerIds.map((id) =>
          freeze({ id, satisfied: byId.get(id)?.status === "done" }),
        ),
      );
      const blocking: TicketBlocking = cycles.has(record.id)
        ? "blocked (cycle)"
        : blockedBy.some((blocker) => !blocker.satisfied)
          ? "blocked"
          : "unblocked";
      return freeze({
        repo: record.repo,
        id: record.id,
        title: record.title,
        status: record.status,
        blockedBy,
        blocking,
        ...(record.assignee ? { assignee: record.assignee } : {}),
        ...(record.verificationCommand
          ? { verificationCommand: record.verificationCommand }
          : {}),
        ...(record.updatedAt === undefined
          ? {}
          : { updatedAt: record.updatedAt }),
        ...(record.measuredStageDurationMs === undefined
          ? {}
          : { measuredStageDurationMs: record.measuredStageDurationMs }),
        eta,
      });
    }),
  );
  return freeze({ ...base, records });
}
