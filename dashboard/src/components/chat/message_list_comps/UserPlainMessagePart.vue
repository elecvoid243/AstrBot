<!-- Author: elecvoid243, 2026-07-30
     Updated 2026-08-09 (elecvoid243): also parse the trailing
     "[Referenced files]" block (useFileReferences.formatForLLM) and
     render it as a FileReferencesCard. Parse order mirrors the send-time
     concat in Chat.vue ([userText, commentText, referenceText]): the
     comments block comes first, so its parser's `userText` may still
     carry the references block — which is parsed out of it here.
     Historical messages get the rich rendering automatically because
     both blocks are parsed back out of the stored message text. -->
<template>
  <div class="user-plain-part">
    <template v-if="review || references">
      <div v-if="displayText" class="plain-content">
        {{ displayText }}
      </div>
      <FileReviewCommentsCard v-if="review" :review="review" />
      <FileReferencesCard v-if="references" :block="references" />
    </template>
    <div v-else class="plain-content">{{ text }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { parseFileReviewComments } from "@/utils/parseFileReviewComments";
import { parseFileReferences } from "@/utils/parseFileReferences";
import FileReviewCommentsCard from "./FileReviewCommentsCard.vue";
import FileReferencesCard from "./FileReferencesCard.vue";

const props = defineProps<{ text: string }>();

// computeds cache on props.text, so each parse runs once per text change
// rather than on every re-render of the (potentially long) message list.
const review = computed(() => parseFileReviewComments(props.text));
const references = computed(() =>
  parseFileReferences(review.value ? review.value.userText : props.text),
);
// The free-form text above the cards: when a references block was found
// it owns the trimming; otherwise the comments parser's userText (or ""
// when only a comments block exists) is what remains.
const displayText = computed(() =>
  references.value ? references.value.userText : (review.value?.userText ?? ""),
);
</script>

<style scoped>
/* Mirrors ChatMessageList's .plain-content (the parent's scoped rule does
   not reach into this child, so it is re-declared here). */
.plain-content {
  white-space: pre-wrap;
}
</style>
