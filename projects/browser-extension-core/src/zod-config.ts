// Zod 4.x JIT-compiles validators with new Function(), which browser extension
// CSPs block. Zod catches the error and falls back, but Firefox still logs a
// noisy CSP violation on every popup open. Disabling JIT avoids the attempt.
// (test 2/4 probe: extension-core edit must publish BOTH chrome and firefox)
//
// This module must be imported before any module-level z.object() call so that
// globalConfig.jitless is set before Zod's $ZodObjectJIT constructor reads it.
import { config } from "zod";
config({ jitless: true });
