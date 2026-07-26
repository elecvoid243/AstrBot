// Author: elecvoid243
// Date: 2026-07-26
// Plan: docs/superpowers/plans/2026-07-26-subagent-chatui-progress.md (Task 5)
// Leaf-module unit tests, runnable from a bare node runner (vitest).
import { describe, expect, it } from "vitest";
import {
  applySubAgentEvent,
  type SubAgentRunPart,
} from "./subagentRunReducer.ts";
import {
  normalizeMessageParts,
  type MessagePart,
} from "./normalizeMessageParts.ts";

function ev(runId: string, kind: string, payload: any, agent = "researcher") {
  return { subagent_run_id: runId, agent_name: agent, kind, payload, ts: 1 };
}

describe("applySubAgentEvent", () => {
  it("folds a full lifecycle into one part at first-seen position", () => {
    const parts: MessagePart[] = [{ type: "plain", text: "before" }];
    applySubAgentEvent(parts, ev("sa_1", "started", { input_preview: "task" }));
    applySubAgentEvent(parts, ev("sa_1", "text_delta", { text: "Hello " }));
    applySubAgentEvent(parts, ev("sa_1", "text_delta", { text: "world" }));
    applySubAgentEvent(parts, ev("sa_1", "reasoning_delta", { text: "hmm" }));
    applySubAgentEvent(
      parts,
      ev("sa_1", "tool_call", { id: "c1", name: "web_search", args: {} }),
    );
    applySubAgentEvent(
      parts,
      ev("sa_1", "tool_call_result", { id: "c1", result: "found" }),
    );
    applySubAgentEvent(
      parts,
      ev("sa_1", "completed", {
        result_text: "Hello world",
        execution_time: 3,
      }),
    );

    expect(parts).toHaveLength(2);
    const part = parts[1] as SubAgentRunPart;
    expect(part.type).toBe("subagent_run");
    expect(part.text).toBe("Hello world");
    expect(part.reasoning).toBe("hmm");
    expect(part.tool_calls).toEqual([
      { id: "c1", name: "web_search", args: {}, result: "found" },
    ]);
    expect(part.status).toBe("completed");
    expect(part.execution_time).toBe(3);
  });

  it("keeps concurrent runs separate", () => {
    const parts: MessagePart[] = [];
    applySubAgentEvent(parts, ev("sa_1", "text_delta", { text: "A" }));
    applySubAgentEvent(
      parts,
      ev("sa_2", "text_delta", { text: "B" }, "writer"),
    );
    expect(parts).toHaveLength(2);
    expect((parts[0] as SubAgentRunPart).text).toBe("A");
    expect((parts[1] as SubAgentRunPart).agent_name).toBe("writer");
  });

  it("marks failure kinds and keeps error", () => {
    const parts: MessagePart[] = [];
    applySubAgentEvent(parts, ev("sa_1", "started", { input_preview: "" }));
    applySubAgentEvent(parts, ev("sa_1", "timeout", { error: "boom" }));
    const part = parts[0] as SubAgentRunPart;
    expect(part.status).toBe("timeout");
    expect(part.error).toBe("boom");
  });

  it("ignores malformed data without throwing", () => {
    const parts: MessagePart[] = [];
    applySubAgentEvent(parts, null);
    applySubAgentEvent(parts, { kind: "text_delta" }); // missing run id
    applySubAgentEvent(parts, "junk");
    expect(parts).toHaveLength(0);
  });
});

describe("normalizeMessageParts subagent_run passthrough", () => {
  it("preserves subagent_run parts from history", () => {
    const stored = [
      { type: "plain", text: "hi" },
      {
        type: "subagent_run",
        subagent_run_id: "sa_1",
        agent_name: "r",
        status: "completed",
        text: "done",
        tool_calls: [],
      },
    ];
    const normalized = normalizeMessageParts(stored);
    expect(normalized).toHaveLength(2);
    expect(normalized[1].type).toBe("subagent_run");
    expect((normalized[1] as any).subagent_run_id).toBe("sa_1");
  });
});
