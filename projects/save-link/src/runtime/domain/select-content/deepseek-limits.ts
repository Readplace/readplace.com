// The exact context length DeepSeek reports in its "maximum context length is
// N tokens" 400 rejection — the authoritative window for this deployment's
// provider. The whole select-content prompt budget is derived from it.
export const DEEPSEEK_CONTEXT_TOKENS = 1_048_565;

// https://api-docs.deepseek.com/quick_start/pricing — deepseek-chat max output is 8K
export const DEEPSEEK_MAX_OUTPUT_TOKENS = 8_192;
