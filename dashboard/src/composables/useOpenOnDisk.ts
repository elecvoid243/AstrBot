/**
 * useOpenOnDisk — shared "open this file on the AstrBot host" action
 * (2026-08-14). Backed by POST /api/v1/chat/open-file, which asks the
 * server to open the path with the OS default application.
 *
 * Extracted after the third call site appeared (FileChangeCard,
 * workspace FileBrowserFilePreview, DocumentManager) so the
 * request/toast/error-shape handling lives in exactly one place.
 *
 * Author: elecvoid243 | 2026-08-14
 */

import { ref } from "vue";
import { chatApi } from "@/api/v1";
import { useToast } from "@/utils/toast";
import { useModuleI18n } from "@/i18n/composables";

/**
 * @param i18nPrefix Key prefix inside features/chat that provides
 *   `opened` ({name}) and `openFailed` ({message}) strings, e.g.
 *   "fileChange" or "spcodeProjectLoad.fileBrowser.preview".
 */
export function useOpenOnDisk(i18nPrefix: string) {
  const { tm } = useModuleI18n("features/chat");
  const toast = useToast();
  /** True while a request is in flight; callers disable their button. */
  const opening = ref(false);

  /**
   * Ask the host to open `path` and toast the outcome.
   *
   * @param path Absolute path on the AstrBot host.
   * @param displayName Short name for the success toast; falls back
   *   to `path` when omitted.
   */
  async function openOnDisk(path: string, displayName?: string) {
    if (opening.value || !path) return;
    opening.value = true;
    try {
      const resp = await chatApi.openLocalFile(path);
      const envelope = resp.data;
      if (envelope?.status === "error") {
        toast.error(
          tm(`${i18nPrefix}.openFailed`, { message: envelope.message || "" }),
        );
      } else {
        toast.success(
          tm(`${i18nPrefix}.opened`, { name: displayName || path }),
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(tm(`${i18nPrefix}.openFailed`, { message }));
    } finally {
      opening.value = false;
    }
  }

  return { opening, openOnDisk };
}
