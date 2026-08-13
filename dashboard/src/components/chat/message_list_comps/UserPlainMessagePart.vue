<!-- Author: elecvoid243, 2026-07-30
     Updated 2026-08-13 (elecvoid243): fixed combined-block rendering.
     Message text layout is [userText][comments block][references block]
     (send-time concat in Chat.vue). parseFileReviewComments only
     returns the text BEFORE the comments marker — which can never
     contain the trailing references block — so references must be
     parsed from the FULL text (its own marker is found anywhere).
     When both blocks exist, display uses the comments parser's
     userText; the references parser's userText would still contain the
     raw comments block and is ignored.
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
// 2026-08-13 fix: parse references from the FULL text, not
// review.userText. userText is only the part BEFORE the comments marker,
// so it can never contain the trailing "[Referenced files]" block —
// feeding it here made the card silently vanish whenever comments and
// references coexisted in one message.
const references = computed(() => parseFileReferences(props.text));
// The free-form text above the cards: when both blocks exist, the
// references parser's userText still contains the raw comments block
// (the comments card renders it richly, so we must not duplicate it);
// the comments parser's userText is the true prefix. When only a
// references block exists, its own userText is the prefix.
const displayText = computed(() => {
  if (review.value) return review.value.userText;
  return references.value?.userText ?? "";
});
</script>

<style scoped>
/* Mirrors ChatMessageList's .plain-content (the parent's scoped rule does
   not reach into this child, so it is re-declared here). */
.plain-content {
  white-space: pre-wrap;
}
</style>
