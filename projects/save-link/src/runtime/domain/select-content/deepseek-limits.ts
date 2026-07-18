// The exact context length DeepSeek reports in its "maximum context length is
// N tokens" 400 rejection — the authoritative window for this deployment's
// provider. The whole select-content prompt budget is derived from it.
export const DEEPSEEK_CONTEXT_TOKENS = 1_048_565;

// A self-imposed output ceiling, not the model limit (v4-flash allows far
// more): the selector verdict is tiny, so clamping keeps output cost bounded.
export const DEEPSEEK_MAX_OUTPUT_TOKENS = 8_192;
