// BinaryPreview container — shallow tests covering state-machine wiring
// and child dispatch.
//
// The composable (useSpcodeFileBinary) is mocked so we don't hit the
// network; the goal here is to assert the container switches the
// rendered child based on data.kind and surfaces the unified error /
// loading placeholders. Real-library wiring (pdfjs/mammoth/xlsx/papaparse)
// is exercised separately by the child-component tests in later tasks.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { ref, type Ref } from "vue";

const mockFetchBinary = vi.fn();
const mockDispose = vi.fn();
const mockGetState = vi.fn();
const mockGetData = vi.fn();

vi.mock("@/composables/useSpcodeFileBinary", () => ({
  useSpcodeFileBinary: () => ({
    fetchBinary: mockFetchBinary,
    getState: mockGetState,
    getData: mockGetData,
    isLoading: (path: string, ref: string) =>
      mockGetState(path, ref).kind === "loading",
    dispose: mockDispose,
    invalidateAll: vi.fn(),
  }),
}));

vi.mock("@/composables/useSpcodeProjectStatus", () => ({
  useSpcodeProjectStatus: () => ({
    status: { value: { umo: "umo-test", directory: "D:/repo", loaded: true } },
    refresh: vi.fn(),
  }),
}));

// Stub child previewers to a stable identifying marker.
const stubs = {
  PdfPreview: { template: '<div class="pdf-stub" />', props: ["blob"] },
  DocxPreview: { template: '<div class="docx-stub" />', props: ["blob"] },
  XlsxPreview: { template: '<div class="xlsx-stub" />', props: ["blob"] },
  CsvPreview: { template: '<div class="csv-stub" />', props: ["blob"] },
  BinaryMarkdownPreview: { template: '<div class="md-stub" />', props: ["blob", "isDark"] },
  "v-progress-circular": { template: '<i class="circ" />' },
  "v-icon": { template: '<i class="icon" />' },
};

import BinaryPreview from "./BinaryPreview.vue";

function setState(state: { kind: string; reason?: string }) {
  mockGetState.mockReturnValue(state);
}
function setData(
  data: {
    blob: Blob;
    path: string;
    ref: string;
    resolvedSha: string;
    kind: string;
    size: number;
    filename: string;
    etag: string;
  } | null,
) {
  mockGetData.mockReturnValue(data);
}

beforeEach(() => {
  mockFetchBinary.mockReset();
  mockDispose.mockReset();
  mockGetState.mockReset();
  mockGetData.mockReset();
  // Default to idle so the loading branch wins on first render.
  setState({ kind: "idle" });
  setData(null);
  mockFetchBinary.mockResolvedValue(undefined);
});

describe("BinaryPreview — dispatch", () => {
  it("triggers fetchBinary() on mount with (path, ref)", async () => {
    mount(BinaryPreview, {
      props: { path: "docs/x.pdf", gitRef: "", worktree: null },
      global: { stubs },
    });
    await flushPromises();
    expect(mockFetchBinary).toHaveBeenCalledWith("docs/x.pdf", "");
  });

  it("refetches when path changes", async () => {
    const wrapper = mount(BinaryPreview, {
      props: { path: "a.pdf", gitRef: "", worktree: null },
      global: { stubs },
    });
    await flushPromises();
    await wrapper.setProps({ path: "b.pdf" });
    await flushPromises();
    expect(mockFetchBinary).toHaveBeenCalledTimes(2);
    expect(mockFetchBinary.mock.calls[0]).toEqual(["a.pdf", ""]);
    expect(mockFetchBinary.mock.calls[1]).toEqual(["b.pdf", ""]);
  });

  it("does not fetch when path is empty", async () => {
    mount(BinaryPreview, {
      props: { path: "", gitRef: "", worktree: null },
      global: { stubs },
    });
    await flushPromises();
    expect(mockFetchBinary).not.toHaveBeenCalled();
  });

  it("renders PdfPreview for kind=pdf", async () => {
    setState({ kind: "ok" });
    setData({
      blob: new Blob(["%PDF"], { type: "application/pdf" }),
      path: "x.pdf",
      ref: "",
      resolvedSha: "",
      kind: "pdf",
      size: 4,
      filename: "x.pdf",
      etag: 'W/"1"',
    });
    const wrapper = mount(BinaryPreview, {
      props: { path: "x.pdf", gitRef: "", worktree: null },
      global: { stubs },
    });
    await flushPromises();
    expect(wrapper.find(".pdf-stub").exists()).toBe(true);
    expect(wrapper.find(".docx-stub").exists()).toBe(false);
  });

  it("renders DocxPreview for kind=docx", async () => {
    setState({ kind: "ok" });
    setData({
      blob: new Blob(),
      path: "x.docx",
      ref: "",
      resolvedSha: "",
      kind: "docx",
      size: 0,
      filename: "x.docx",
      etag: "",
    });
    const wrapper = mount(BinaryPreview, {
      props: { path: "x.docx", gitRef: "", worktree: null },
      global: { stubs },
    });
    await flushPromises();
    expect(wrapper.find(".docx-stub").exists()).toBe(true);
  });

  it("renders XlsxPreview for kind=xlsx", async () => {
    setState({ kind: "ok" });
    setData({
      blob: new Blob(),
      path: "x.xlsx",
      ref: "",
      resolvedSha: "",
      kind: "xlsx",
      size: 0,
      filename: "x.xlsx",
      etag: "",
    });
    const wrapper = mount(BinaryPreview, {
      props: { path: "x.xlsx", gitRef: "", worktree: null },
      global: { stubs },
    });
    await flushPromises();
    expect(wrapper.find(".xlsx-stub").exists()).toBe(true);
  });

  it("renders CsvPreview for kind=csv", async () => {
    setState({ kind: "ok" });
    setData({
      blob: new Blob(),
      path: "x.csv",
      ref: "",
      resolvedSha: "",
      kind: "csv",
      size: 0,
      filename: "x.csv",
      etag: "",
    });
    const wrapper = mount(BinaryPreview, {
      props: { path: "x.csv", gitRef: "", worktree: null },
      global: { stubs },
    });
    await flushPromises();
    expect(wrapper.find(".csv-stub").exists()).toBe(true);
  });

  it("renders BinaryMarkdownPreview for kind=md", async () => {
    setState({ kind: "ok" });
    setData({
      blob: new Blob(),
      path: "x.md",
      ref: "",
      resolvedSha: "",
      kind: "md",
      size: 0,
      filename: "x.md",
      etag: "",
    });
    const wrapper = mount(BinaryPreview, {
      props: { path: "x.md", gitRef: "", worktree: null },
      global: { stubs },
    });
    await flushPromises();
    expect(wrapper.find(".md-stub").exists()).toBe(true);
  });
});

describe("BinaryPreview — state machine", () => {
  it("shows the loading placeholder while loading", async () => {
    setState({ kind: "loading" });
    const wrapper = mount(BinaryPreview, {
      props: { path: "x.pdf", gitRef: "", worktree: null },
      global: { stubs },
    });
    await flushPromises();
    expect(wrapper.find(".binary-preview__placeholder").exists()).toBe(true);
    expect(wrapper.find(".circ").exists()).toBe(true);
  });

  it("shows the error placeholder when fetch errors", async () => {
    setState({ kind: "error", reason: "too_large" });
    const wrapper = mount(BinaryPreview, {
      props: { path: "x.pdf", gitRef: "", worktree: null },
      global: { stubs },
    });
    await flushPromises();
    const placeholder = wrapper.find(".binary-preview__placeholder--error");
    expect(placeholder.exists()).toBe(true);
  });

  it("renders header with filename + size when data is available", async () => {
    setState({ kind: "ok" });
    setData({
      blob: new Blob(),
      path: "x.pdf",
      ref: "",
      resolvedSha: "",
      kind: "pdf",
      size: 2048,
      filename: "manual.pdf",
      etag: "",
    });
    const wrapper = mount(BinaryPreview, {
      props: { path: "x.pdf", gitRef: "", worktree: null },
      global: { stubs },
    });
    await flushPromises();
    const header = wrapper.find(".binary-preview__header");
    expect(header.exists()).toBe(true);
    expect(header.text()).toContain("manual.pdf");
    expect(header.text()).toMatch(/2\.0\s*KB/);
  });

  it("disposes the composable on unmount", async () => {
    const wrapper = mount(BinaryPreview, {
      props: { path: "x.pdf", gitRef: "", worktree: null },
      global: { stubs },
    });
    await flushPromises();
    wrapper.unmount();
    expect(mockDispose).toHaveBeenCalled();
  });
});
