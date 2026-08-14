// Tests for useOpenOnDisk — the shared "open file on the AstrBot
// host" action composable (2026-08-14). API and toast are mocked;
// i18n resolves real zh-CN strings via vitest.setup.ts.
//
// Author: elecvoid243 | 2026-08-14

import { describe, it, expect, vi, beforeEach } from "vitest";
import { useOpenOnDisk } from "./useOpenOnDisk";

const mocks = vi.hoisted(() => ({
  openLocalFile: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/api/v1", () => ({
  chatApi: {
    openLocalFile: mocks.openLocalFile,
  },
}));

vi.mock("@/utils/toast", () => ({
  useToast: () => ({
    error: mocks.toastError,
    success: mocks.toastSuccess,
  }),
}));

describe("useOpenOnDisk", () => {
  beforeEach(() => {
    mocks.openLocalFile.mockReset();
    mocks.toastError.mockReset();
    mocks.toastSuccess.mockReset();
    mocks.openLocalFile.mockResolvedValue({
      data: { status: "ok", message: null, data: {} },
    });
  });

  it("posts the path and toasts the display name on success", async () => {
    const { openOnDisk, opening } = useOpenOnDisk("fileChange");
    await openOnDisk("F:\\proj\\a.py", "a.py");
    expect(mocks.openLocalFile).toHaveBeenCalledWith("F:\\proj\\a.py");
    expect(mocks.toastSuccess).toHaveBeenCalledWith("已打开 a.py");
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(opening.value).toBe(false);
  });

  it("falls back to the full path when no display name is given", async () => {
    const { openOnDisk } = useOpenOnDisk("fileChange");
    await openOnDisk("F:\\proj\\a.py");
    expect(mocks.toastSuccess).toHaveBeenCalledWith("已打开 F:\\proj\\a.py");
  });

  it("toasts the backend message on an error envelope", async () => {
    mocks.openLocalFile.mockResolvedValue({
      data: { status: "error", message: "File not found: x" },
    });
    const { openOnDisk } = useOpenOnDisk("fileChange");
    await openOnDisk("F:\\proj\\a.py");
    expect(mocks.toastError).toHaveBeenCalledWith(
      "打开文件失败：File not found: x",
    );
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it("toasts the exception message when the request throws", async () => {
    mocks.openLocalFile.mockRejectedValue(new Error("network down"));
    const { openOnDisk } = useOpenOnDisk("fileChange");
    await openOnDisk("F:\\proj\\a.py");
    expect(mocks.toastError).toHaveBeenCalledWith("打开文件失败：network down");
  });

  it("ignores empty paths and overlapping invocations", async () => {
    const { openOnDisk } = useOpenOnDisk("fileChange");
    await openOnDisk("");
    expect(mocks.openLocalFile).not.toHaveBeenCalled();

    let resolvePending: (v: unknown) => void = () => {};
    mocks.openLocalFile.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePending = resolve;
        }),
    );
    const first = openOnDisk("F:\\proj\\a.py");
    await openOnDisk("F:\\proj\\b.py");
    resolvePending({ data: { status: "ok", message: null, data: {} } });
    await first;
    expect(mocks.openLocalFile).toHaveBeenCalledTimes(1);
  });
});
