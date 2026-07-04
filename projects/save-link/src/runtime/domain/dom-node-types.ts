/**
 * The two `Node.nodeType` codes this project's linkedom DOM walks branch on,
 * named so callers read intent instead of a bare integer. Shared so the
 * select-content condenser and the summary text-stripper reference one source
 * rather than each spelling the codes out (one named, one magic) and drifting.
 * @see https://developer.mozilla.org/en-US/docs/Web/API/Node/nodeType
 */
export const TEXT_NODE = 3;
export const COMMENT_NODE = 8;
