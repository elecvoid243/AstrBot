<template>
  <div class="spcode-chip" :class="stateClass" :title="tooltipText">
    <component :is="stateIcon" :size="14" class="spcode-chip-icon" />
    <span class="spcode-chip-text">{{ stateText }}</span>
    <v-menu
      v-if="canShowDetails"
      v-model="popoverOpen"
      location="bottom start"
      transition="none"
    >
      <template #activator="{ props: menuProps }">
        <button
          v-bind="menuProps"
          class="spcode-chip-details-btn"
          type="button"
          @click.stop
        >
          <ChevronDown :size="14" />
        </button>
      </template>
      <v-card class="spcode-chip-popover" min-width="320" max-width="480">
        <v-card-text>
          <div class="spcode-chip-popover-title">{{ popoverTitle }}</div>
          <pre class="spcode-chip-popover-messages">{{ detailText }}</pre>
        </v-card-text>
      </v-card>
    </v-menu>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  HelpCircle,
  Loader2,
  XCircle,
} from "@lucide/vue";
import { useSpcodeProjectStatus } from "@/composables/useSpcodeProjectStatus";
import { useModuleI18n } from "@/i18n/composables";

const props = defineProps<{
  umo: string | null;
  workspacePath: string;
}>();

const { tm } = useModuleI18n("features/chat");
const { status } = useSpcodeProjectStatus();
const popoverOpen = ref(false);

// The status ref is module-scoped; only show chip data when the loaded
// umo matches the umo this chip is bound to.
const isThisUmo = computed(
  () => Boolean(props.umo) && status.value.umo === props.umo,
);
const state = computed(() => {
  if (!props.umo) return "no_session";
  if (!isThisUmo.value) return "unknown";
  if (status.value.loaded) {
    return status.value.directory === props.workspacePath
      ? "loaded"
      : "mismatch";
  }
  return "unloaded";
});

const stateClass = computed(() => `is-${state.value}`);
const stateIcon = computed(() => {
  switch (state.value) {
    case "loaded":
      return CheckCircle2;
    case "mismatch":
      return AlertCircle;
    case "no_session":
      return HelpCircle;
    case "unloaded":
      return Loader2;
    default:
      return XCircle;
  }
});
const stateText = computed(() => {
  switch (state.value) {
    case "loaded":
      return tm("project.spcode.chipLoaded", {
        directory: status.value.directory ?? "",
      });
    case "mismatch":
      return tm("project.spcode.chipFailed");
    case "no_session":
      return tm("project.spcode.chipNoSession");
    case "unloaded":
      return tm("project.spcode.chipLoading");
    default:
      return tm("project.spcode.chipDisabled");
  }
});
const tooltipText = computed(() => stateText.value);
const canShowDetails = computed(
  () => state.value === "loaded" || state.value === "mismatch",
);
const detailText = computed(() => {
  if (state.value === "loaded") {
    return `Expected: ${props.workspacePath}\nLoaded: ${status.value.directory ?? ""}`;
  }
  if (state.value === "mismatch") {
    return `Expected: ${props.workspacePath}\nLoaded: ${status.value.directory ?? ""}`;
  }
  return "";
});
const popoverTitle = computed(() => {
  if (state.value === "loaded") {
    return tm("project.spcode.chipLoaded", {
      directory: status.value.directory ?? "",
    });
  }
  if (state.value === "mismatch") {
    return tm("project.spcode.chipFailed");
  }
  return "";
});
</script>

<style scoped>
.spcode-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
  line-height: 18px;
  background: rgba(var(--v-theme-on-surface), 0.04);
}
.spcode-chip-icon {
  flex: 0 0 auto;
}
.spcode-chip-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 280px;
}
.is-loaded {
  color: rgb(var(--v-theme-success));
}
.is-mismatch {
  color: rgb(var(--v-theme-warning));
}
.is-no_session,
.is-unknown,
.is-unloaded {
  color: rgba(var(--v-theme-on-surface), 0.52);
}
.spcode-chip-details-btn {
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  padding: 0;
}
.spcode-chip-popover-messages {
  margin: 0;
  white-space: pre-wrap;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  line-height: 1.5;
  max-height: 240px;
  overflow-y: auto;
}
.spcode-chip-popover-title {
  font-weight: 600;
  margin-bottom: 8px;
}
</style>
