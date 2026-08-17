<template>
  <div class="collab-route-card">
    <template v-if="payload.action === 'route'">
      <div class="d-flex align-center">
        <v-icon size="small" class="mr-1">mdi-arrow-right-bold</v-icon>
        <span>路由至 <b>{{ displayTarget }}</b></span>
        <v-chip size="x-small" class="ml-2" variant="tonal">
          {{ payload.mode === 'forward' ? '引用转发' : '转述' }}
        </v-chip>
      </div>
      <div v-if="payload.content" class="text-caption mt-1">{{ payload.content }}</div>
    </template>
    <template v-else-if="payload.action === 'end'">
      <div class="d-flex align-center">
        <v-icon size="small" class="mr-1">mdi-flag-checkered</v-icon>
        <span>讨论结束</span>
      </div>
      <div v-if="payload.summary" class="text-caption mt-1">{{ payload.summary }}</div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  payload: { action: string; target?: string; mode?: string; content?: string; summary?: string };
  aliasOf?: (label: string) => string;
}>();

const displayTarget = computed(() =>
  props.aliasOf && props.payload.target ? props.aliasOf(props.payload.target) : props.payload.target,
);
</script>

<style scoped>
.collab-route-card {
  border-left: 3px solid rgb(var(--v-theme-primary));
  padding: 8px 12px;
  margin: 8px 0;
  background: rgba(var(--v-theme-primary), 0.06);
  border-radius: 4px;
  font-size: 0.875rem;
}
</style>
