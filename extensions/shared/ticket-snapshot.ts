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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

type ParsedTicket = Omit<TicketRecord, "blockedBy" | "blocking" | "eta"> & {
  readonly blockerIds: readonly string[];
  readonly blockersValid: boolean;
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
  const matches = [
    ...section.matchAll(/^Status:\s*\*\*([^*]+)\*\*(?=\s*(?:·|\(|$))/gm),
  ];
  if (matches.length !== 1) return "unknown";
  return STATUS_BY_TEXT[matches[0]![1]!.trim().toLowerCase()] ?? "unknown";
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
  if (!value || /^none\s*$/i.test(value)) return freeze([]);
  return freeze([...new Set(value.match(/PI-\d+/g) ?? [])]);
}

function blockersValid(section: string) {
  const value = field(section, "Blocked-by");
  if (!value || /^none\s*$/i.test(value)) return true;
  if (/^none\b/i.test(value)) return false;
  const ids = value.match(/PI-\d+/g) ?? [];
  const remainder = value
    .replace(/PI-\d+/g, "")
    .replace(/\([^\n)]*\)/g, "")
    .replace(/[\s,]/g, "");
  return (
    ids.length > 0 && new Set(ids).size === ids.length && remainder.length === 0
  );
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

function isValidTicketRecord(
  value: unknown,
  repo: string,
): value is TicketRecord {
  if (
    !isRecord(value) ||
    value.repo !== repo ||
    typeof value.id !== "string" ||
    value.id.trim().length === 0 ||
    typeof value.title !== "string" ||
    value.title.trim().length === 0 ||
    typeof value.status !== "string" ||
    value.status === "unknown" ||
    !TICKET_STATUSES.includes(value.status as TicketStatus) ||
    !Array.isArray(value.blockedBy) ||
    !["unblocked", "blocked", "blocked (cycle)"].includes(
      value.blocking as string,
    ) ||
    (value.assignee !== undefined &&
      !["planner", "coder", "debugger", "reviewer"].includes(
        value.assignee as string,
      )) ||
    (value.verificationCommand !== undefined &&
      (typeof value.verificationCommand !== "string" ||
        value.verificationCommand.trim().length === 0)) ||
    (value.updatedAt !== undefined &&
      (typeof value.updatedAt !== "number" ||
        !Number.isFinite(value.updatedAt))) ||
    (value.measuredStageDurationMs !== undefined &&
      (typeof value.measuredStageDurationMs !== "number" ||
        !Number.isSafeInteger(value.measuredStageDurationMs) ||
        value.measuredStageDurationMs <= 0)) ||
    !isRecord(value.eta)
  ) {
    return false;
  }

  const blockerIds = new Set<string>();
  for (const blocker of value.blockedBy) {
    if (
      !isRecord(blocker) ||
      typeof blocker.id !== "string" ||
      blocker.id.trim().length === 0 ||
      blockerIds.has(blocker.id) ||
      typeof blocker.satisfied !== "boolean"
    ) {
      return false;
    }
    blockerIds.add(blocker.id);
  }
  const hasUnsatisfiedBlocker = value.blockedBy.some(
    (blocker) => isRecord(blocker) && blocker.satisfied === false,
  );
  if (
    (value.blocking === "unblocked" && hasUnsatisfiedBlocker) ||
    (value.blocking === "blocked" && !hasUnsatisfiedBlocker) ||
    (value.blocking === "blocked (cycle)" && value.blockedBy.length === 0) ||
    (value.status === "done" && value.blocking !== "unblocked")
  ) {
    return false;
  }

  if (value.eta.kind === "unknown") return true;
  if (value.eta.kind !== "estimated") return false;
  const minMs = value.eta.minMs;
  const maxMs = value.eta.maxMs;
  const n = value.eta.n;
  return (
    typeof minMs === "number" &&
    Number.isSafeInteger(minMs) &&
    minMs > 0 &&
    typeof maxMs === "number" &&
    Number.isSafeInteger(maxMs) &&
    maxMs >= minMs &&
    typeof n === "number" &&
    Number.isSafeInteger(n) &&
    n >= 3
  );
}

/**
 * Validates a completed tracker snapshot before any renderer consumes it.
 * Duplicate IDs, unknown statuses, malformed blockers, and contradictory
 * blocker/status pairs fail closed instead of becoming guessed progress.
 */
export function isValidTicketSnapshot(value: unknown): value is TicketSnapshot {
  try {
    if (
      !isRecord(value) ||
      typeof value.repo !== "string" ||
      value.repo.trim().length === 0 ||
      !Number.isFinite(value.capturedAt) ||
      !Array.isArray(value.records) ||
      (value.reason !== undefined &&
        (typeof value.reason !== "string" || value.reason.trim().length === 0))
    ) {
      return false;
    }

    const records = value.records;
    const ids = new Set<string>();
    for (const record of records) {
      if (!isValidTicketRecord(record, value.repo)) return false;
      if (ids.has(record.id)) return false;
      ids.add(record.id);
    }
    const byId = new Map(records.map((record) => [record.id, record] as const));
    for (const record of records) {
      for (const blocker of record.blockedBy) {
        const target = byId.get(blocker.id);
        if (blocker.satisfied !== (target?.status === "done")) return false;
      }
    }
    return true;
  } catch {
    return false;
  }
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
  // A malformed or truncated heading must still end the previous ticket's
  // section; otherwise a missing-status ticket inherits metadata from the
  // malformed heading's following lines. Any ATX heading closes a section.
  const sectionBreaks = [...searchableTracker.matchAll(/^#{1,6}\s+/gm)].map(
    (match) => match.index ?? 0,
  );

  let sectionBreakIndex = 0;
  const parsed = headings.map((heading) => {
    while (
      sectionBreakIndex < sectionBreaks.length &&
      sectionBreaks[sectionBreakIndex]! <= heading.index
    ) {
      sectionBreakIndex += 1;
    }
    const end = sectionBreaks[sectionBreakIndex] ?? tracker.length;
    const section = searchableTracker.slice(heading.index, end);
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
      blockersValid: blockersValid(section),
      assignee: assigneeFrom(explicitAssignee, status),
      ...(verificationCommand ? { verificationCommand } : {}),
      ...(updatedAt === undefined ? {} : { updatedAt }),
      ...(duration === undefined ? {} : { measuredStageDurationMs: duration }),
    } satisfies ParsedTicket;
  });
  if (parsed.some((record) => record.status === "unknown")) {
    return freeze({ ...base, records: freeze([]), reason: "invalid status" });
  }
  if (parsed.some((record) => !record.blockersValid)) {
    return freeze({
      ...base,
      records: freeze([]),
      reason: "invalid blockers",
    });
  }
  if (new Set(parsed.map((record) => record.id)).size !== parsed.length) {
    return freeze({
      ...base,
      records: freeze([]),
      reason: "duplicate ticket id",
    });
  }
  const byId = uniqueRecordsById(parsed);
  const cycles = cycleIds(parsed, byId);
  if (
    parsed.some(
      (record) =>
        record.status === "done" &&
        (record.blockerIds.some((id) => byId.get(id)?.status !== "done") ||
          cycles.has(record.id)),
    )
  ) {
    return freeze({
      ...base,
      records: freeze([]),
      reason: "contradictory blockers",
    });
  }
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
