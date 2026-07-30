<!-- Author: elecvoid243, 2026-07-30
     Renders a user message's plain-text part. When the text ends with a
     "[File review comments]" block (appended on send by
     useFileComments.formatForLLM), the block is parsed and rendered as a
     FileReviewCommentsCard with the user's free-form text shown above it;
     otherwise the text renders exactly as before (pre-wrap plain text).

     Because the block is parsed back out of the stored message text,
     historical messages get the rich rendering automatically — no backend
     or data migration required. -->
<template>
  <div class="user-plain-part">
    <template v-if="review">
      <div v-if="review.userText" class="plain-content">
        {{ review.userText }}
      </div>
      <FileReviewCommentsCard :review="review" />
    </template>
    <div v-else class="plain-content">{{ text }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { parseFileReviewComments } from "@/utils/parseFileReviewComments";
import FileReviewCommentsCard from "./FileReviewCommentsCard.vue";

const props = defineProps<{ text: string }>();

// computed caches on props.text, so the parse runs once per text change
// rather than on every re-render of the (potentially long) message list.
const review = computed(() => parseFileReviewComments(props.text));
</script>

<style scoped>
/* Mirrors ChatMessageList's .plain-content (the parent's scoped rule does
   not reach into this child, so it is re-declared here). */
.plain-content {
  white-space: pre-wrap;
}
</style>
