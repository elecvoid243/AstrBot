/**
 * useOpenOnDisk — shared "open this file on the AstrBot host" action
 * (2026-08-14). Backed by POST /api/v1/chat/open-file, which asks the
 * server to open the path with the OS default application. The
 * `openFolder` variant (2026-08-21) reveals the file's containing
 * folder via POST /api/v1/chat/open-folder instead.
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
   * @param folder Reveal the file's containing folder (POST /chat/open-folder)
   *   instead of opening the file itself.
   */
  async function openOnDisk(path: string, displayName?: string, folder = false) {
    if (opening.value || !path) return;
    opening.value = true;
    try {
      const resp = folder
        ? await chatApi.openLocalFolder(path)
        : await chatApi.openLocalFile(path);
      const envelope = resp.data;
      if (envelope?.status === "error") {
        toast.error(
          tm(folder ? `${i18nPrefix}.folderOpenFailed` : `${i18nPrefix}.openFailed`, {
            message: envelope.message || "",
          }),
        );
      } else {
        toast.success(
          tm(folder ? `${i18nPrefix}.folderOpened` : `${i18nPrefix}.opened`, {
            name: displayName || path,
          }),
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(
        tm(folder ? `${i18nPrefix}.folderOpenFailed` : `${i18nPrefix}.openFailed`, { message }),
      );
    } finally {
      opening.value = false;
    }
  }

  /** Open the folder containing `path` in the host file manager. */
  function openFolder(path: string, displayName?: string) {
    return openOnDisk(path, displayName, true);
  }

  return { opening, openOnDisk, openFolder };
}
