export const DEEPSEEK_MODEL = "deepseek-v4-flash";

// deepseek-v4-flash defaults to thinking mode; the summariser, triage, and OCR
// flows need the non-thinking path deepseek-chat used — thinking mode bills the
// discarded reasoning as output tokens and rejects the temperature the OCR
// adapters set. Disable it explicitly on every call.
// https://api-docs.deepseek.com/guides/thinking_mode/
export const DEEPSEEK_NON_THINKING: { type: "disabled" } = { type: "disabled" };
