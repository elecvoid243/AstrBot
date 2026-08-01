import { setCustomComponents } from "markstream-vue";
import "markstream-vue/index.css";
import HtmlGenUiNode from "@/components/chat/message_list_comps/HtmlGenUiNode.vue";
import RefNode from "@/components/chat/message_list_comps/RefNode.vue";
import ThreadNode from "@/components/chat/message_list_comps/ThreadNode.vue";
import ShikiCodeBlock from "@/components/shared/ShikiCodeBlock.vue";

export const CHAT_MARKDOWN_CUSTOM_TAGS: string[] = ["ref", "html-genui"];

export function registerChatMarkdownComponents() {
  setCustomComponents("chat-message", {
    ref: RefNode,
    thread: ThreadNode,
    "html-genui": HtmlGenUiNode,
    code_block: ShikiCodeBlock,
  });
}

/**
 * 2026-07-31 shiki-code-block: MarkdownView (custom-id "document-view")
 * renders markdown for the document manager / workspace preview and the
 * readme dialog. Register the same lightweight code block so those views
 * get highlighting too; setCustomComponents is idempotent per custom-id,
 * so calling this from every MarkdownView setup is safe.
 */
export function registerDocumentViewMarkdownComponents() {
  setCustomComponents("document-view", {
    code_block: ShikiCodeBlock,
  });
}
