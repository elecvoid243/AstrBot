// Author: elecvoid243, 2026-07-22
// Type shim for mammoth/mammoth.browser — the pre-bundled UMD entry
// we use in DocxPreview. The package ships its own types for the
// main "mammoth" entry but not for the browser bundle. We re-export
// the same surface as a CommonJS module so DocxPreview can use
// `import * as mammoth from "mammoth/mammoth.browser"`. This file
// must stay *not* a module (no top-level imports/exports) so the
// `declare module` block is treated as a fresh ambient declaration.
declare module "mammoth/mammoth.browser" {
  import type * as MammothNS from "mammoth";
  const mammoth: typeof MammothNS;
  export = mammoth;
}
