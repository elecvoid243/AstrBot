<template>
  <CollabRouteCard v-if="directivePayload" :payload="directivePayload" />
  <ThemeAwareMarkdownCodeBlock v-else v-bind="$attrs" :node="node" :is-dark="isDark" />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import CollabRouteCard from '@/components/chat/message_list_comps/CollabRouteCard.vue';
import ThemeAwareMarkdownCodeBlock from '@/components/shared/ThemeAwareMarkdownCodeBlock.vue';

const props = defineProps<{
  node: Record<string, unknown>;
  isDark?: boolean;
}>();

// Only fenced ```collab-route blocks with a valid JSON directive payload are
// rendered as route cards; anything else (including invalid JSON) falls back
// to the default code block.
const directivePayload = computed(() => {
  if (props.node.lang !== 'collab-route') return null;
  const content = String(props.node.content ?? props.node.code ?? '');
  try {
    const data = JSON.parse(content);
    if (data && typeof data === 'object' && (data.action === 'route' || data.action === 'end')) {
      return data as {
        action: string;
        target?: string;
        mode?: string;
        content?: string;
        summary?: string;
      };
    }
  } catch {
    // fall through to code block
  }
  return null;
});
</script>
