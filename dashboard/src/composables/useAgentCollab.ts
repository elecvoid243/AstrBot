import { computed, reactive, ref } from 'vue';
import { fetchWithAuth } from '@/api/http';
import { agentCollabApi } from '@/api/v1';

export interface CollabGroup {
  id: string;
  name: string;
  members: Array<{ session_id: string; alias: string }>;
  moderator_session_id: string;
  [key: string]: unknown;
}

export interface TimelineItem {
  type: string;
  [key: string]: unknown;
}

export interface CollabMessage {
  type: 'message';
  direction: 'sent' | 'reply' | 'stream';
  session_id: string;
  text: string;
  parts?: Array<Record<string, any>>;
  ts?: string | number;
  [key: string]: unknown;
}

// Stable per-id colors for group badges and per-member transcript rows.
const COLLAB_COLORS = [
  '#e53935',
  '#8e24aa',
  '#3949ab',
  '#00897b',
  '#f4511e',
  '#d81b60',
  '#6d4c41',
  '#43a047',
];

function colorOf(key: string) {
  const hash = [...key].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return COLLAB_COLORS[hash % COLLAB_COLORS.length];
}

export function collabGroupColor(groupId: string) {
  return colorOf(groupId);
}

export function collabMemberColor(sessionId: string) {
  return colorOf(sessionId);
}

export function collabWithAlpha(hex: string, alpha: number) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Module-level singleton state: multiple components (panel, bind dialog,
// chat page) share one collab session and one SSE connection.
const groups = ref<CollabGroup[]>([]);
const activeDiscussion = ref<string | null>(null);
// The group a running discussion belongs to — drives the sidebar chain-badge
// "running" animation on that group's member sessions.
const activeDiscussionGroupId = ref<string | null>(null);
// Routing events only (route/busy/hop/stopped/...) — drives CollabPanel.
const timeline = ref<TimelineItem[]>([]);
// Per-turn messages (sent/reply/stream) — drives the group transcript.
const transcript = ref<CollabMessage[]>([]);
// Persistent-history base loaded from the per-session records; live events
// that duplicate a history entry (same session + direction + text) are
// dropped, so the panel survives page reloads without extra storage.
const historyBase = ref<CollabMessage[]>([]);
const status = ref<'idle' | 'running' | 'paused' | 'stopping' | 'stopped'>('idle');
const hopInfo = reactive({ count: 0, limit: 50 });
const busySessions = ref<Set<string>>(new Set());
let streamAbort: AbortController | null = null;

async function readCollabStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: any) => void,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() || '';
    for (const event of events) {
      const data = event
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (!data) continue;
      try {
        onEvent(JSON.parse(data));
      } catch (error) {
        console.error('Failed to parse collab SSE payload:', error, data);
      }
    }
  }
}

function handleStreamEvent(event: TimelineItem) {
  // Message events feed the group transcript; consecutive stream deltas from
  // the same session are appended to the currently-streaming entry, and the
  // final reply replaces that entry (full parts: thinking / tools / output).
  if (event.type === 'message') {
    const msg = event as unknown as CollabMessage;
    if (msg.direction === 'stream') {
      const last = transcript.value[transcript.value.length - 1];
      if (last && last.direction === 'stream' && last.session_id === msg.session_id) {
        transcript.value[transcript.value.length - 1] = {
          ...last,
          text: last.text + msg.text,
        };
      } else {
        transcript.value.push({ ...msg });
      }
    } else if (msg.direction === 'reply') {
      const last = transcript.value[transcript.value.length - 1];
      if (last && last.direction === 'stream' && last.session_id === msg.session_id) {
        transcript.value[transcript.value.length - 1] = { ...msg };
      } else {
        transcript.value.push({ ...msg });
      }
    } else {
      transcript.value.push({ ...msg });
    }
    return;
  }
  timeline.value.push(event);
  if (event.type === 'hop') {
    hopInfo.count = Number(event.count ?? 0);
    hopInfo.limit = Number(event.limit ?? 50);
  } else if (event.type === 'busy') {
    busySessions.value = new Set(busySessions.value).add(String(event.session_id));
  } else if (event.type === 'route') {
    const next = new Set(busySessions.value);
    next.delete(String(event.from));
    busySessions.value = next;
  } else if (
    event.type === 'route_parse_failed' ||
    event.type === 'hop_limit_reached' ||
    event.type === 'error'
  ) {
    status.value = 'paused';
  } else if (event.type === 'stopped') {
    status.value = 'stopped';
  }
}

async function loadGroups() {
  const res = await agentCollabApi.listGroups();
  groups.value = res.data.data?.groups ?? [];
}

async function startDiscussion(groupId: string, topic: string) {
  const res = await agentCollabApi.startDiscussion(groupId, topic);
  activeDiscussion.value = res.data.data?.discussion_id ?? null;
  if (activeDiscussion.value) {
    activeDiscussionGroupId.value = groupId;
    timeline.value = [];
    status.value = 'running';
    connectStream(activeDiscussion.value);
  }
}

async function connectStream(id: string) {
  disconnectStream();
  streamAbort = new AbortController();
  const abort = streamAbort;
  try {
    const response = await fetchWithAuth(agentCollabApi.streamUrl(id), {
      headers: { Accept: 'text/event-stream' },
      signal: abort.signal,
    });
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok || !response.body || !contentType.includes('text/event-stream')) {
      return;
    }
    await readCollabStream(response.body, handleStreamEvent);
  } catch (error) {
    if (!abort.signal.aborted) {
      console.error('Collab event stream failed:', error);
    }
  }
}

function disconnectStream() {
  streamAbort?.abort();
  streamAbort = null;
}

// Reconnect and rebuild state from the server-side event replay, so panels
// opened mid-discussion still see every past turn.
async function restartStream() {
  timeline.value = [];
  transcript.value = [];
  busySessions.value = new Set();
  if (activeDiscussion.value) {
    await connectStream(activeDiscussion.value);
  }
}

// Group-transcript view: persistent history first, then live events that do
// not duplicate an already-persisted entry (keyed by session/direction/text).
const messages = computed<CollabMessage[]>(() => {
  const seen = new Set(
    historyBase.value.map((m) => `${m.session_id}|${m.direction}|${m.text}`),
  );
  const live = transcript.value.filter(
    (m) => !seen.has(`${m.session_id}|${m.direction}|${m.text}`),
  );
  return [...historyBase.value, ...live];
});

async function loadTranscriptHistory(groupId: string) {
  const res = await agentCollabApi.groupTranscript(groupId);
  historyBase.value = ((res.data.data?.messages ?? []) as CollabMessage[]).map(
    (m) => ({ ...m, type: 'message' as const }),
  );
}

// Member sessions of the group currently hosting a discussion.
const activeDiscussionSessionIds = computed(() => {
  if (!activeDiscussionGroupId.value) return new Set<string>();
  const group = groups.value.find((g) => g.id === activeDiscussionGroupId.value);
  return new Set((group?.members ?? []).map((m) => m.session_id));
});

// Re-attach to a discussion that kept running server-side after a page
// reload: restores the discussion id/status and reconnects the SSE stream
// (full event replay rebuilds timeline + transcript).
async function recoverActiveDiscussion() {
  const res = await agentCollabApi.activeDiscussion();
  const d = res.data.data?.discussion;
  if (!d?.id) return null;
  activeDiscussion.value = d.id;
  activeDiscussionGroupId.value = String(d.group_id || '');
  status.value =
    d.status === 'paused' ? 'paused' : d.status === 'stopping' ? 'stopping' : 'running';
  void connectStream(d.id);
  return String(d.group_id || '');
}

async function stop() {
  if (!activeDiscussion.value || status.value === 'stopping') return;
  // Immediate feedback: the backend runner may take a while to wind down
  // (it finishes the in-flight reply collection), and the final "stopped"
  // event arrives over SSE afterwards.
  status.value = 'stopping';
  try {
    await agentCollabApi.stopDiscussion(activeDiscussion.value);
  } catch (error) {
    status.value = 'running';
    console.error('Failed to stop collab discussion:', error);
  }
}

async function resume(resetHops = false) {
  if (activeDiscussion.value) {
    await agentCollabApi.resumeDiscussion(activeDiscussion.value, resetHops);
    status.value = 'running';
  }
}

async function manualRoute(targetSessionId: string, message: string) {
  if (activeDiscussion.value) {
    await agentCollabApi.routeDiscussion(activeDiscussion.value, targetSessionId, message);
    status.value = 'running';
  }
}

export function useAgentCollab() {
  return {
    groups,
    activeDiscussion,
    activeDiscussionSessionIds,
    timeline,
    messages,
    status,
    hopInfo,
    busySessions,
    loadGroups,
    loadTranscriptHistory,
    recoverActiveDiscussion,
    startDiscussion,
    stop,
    resume,
    manualRoute,
    connectStream,
    disconnectStream,
    restartStream,
  };
}
