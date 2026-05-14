/**
 * pdfjs-dist v4 ships `.d.mts` type declarations for its legacy build
 * subpath, but `moduleResolution: "node"` (used across the monorepo)
 * cannot resolve `.d.mts` files. The dynamic `import()` at runtime
 * works correctly; this declaration tells TypeScript the module exists.
 */
declare module "pdfjs-dist/legacy/build/pdf.mjs";
