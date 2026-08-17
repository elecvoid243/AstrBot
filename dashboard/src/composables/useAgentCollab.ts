import { reactive, ref } from 'vue';
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

// Module-level singleton state: multiple components (panel, bind dialog,
// chat page) share one collab session and one SSE connection.
const groups = ref<CollabGroup[]>([]);
const activeDiscussion = ref<string | null>(null);
const timeline = ref<TimelineItem[]>([]);
const status = ref<'idle' | 'running' | 'paused' | 'stopped'>('idle');
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

async function stop() {
  if (activeDiscussion.value) await agentCollabApi.stopDiscussion(activeDiscussion.value);
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
    timeline,
    status,
    hopInfo,
    busySessions,
    loadGroups,
    startDiscussion,
    stop,
    resume,
    manualRoute,
    connectStream,
    disconnectStream,
  };
}
