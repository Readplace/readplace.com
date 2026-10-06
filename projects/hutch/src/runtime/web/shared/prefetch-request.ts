import type { Request } from "express";

/** A browser prefetch (`Sec-Purpose: prefetch`, its `prefetch;prerender` form,
 * or the legacy `Purpose: prefetch`) is not a reader deciding to open the
 * article. `String(...)` (not `?.`) folds the absent-header case into a plain
 * `false` without a nullish branch the coverage gate can't reach. */
export function isPrefetchRequest(req: Request): boolean {
	if (String(req.get("sec-purpose")).includes("prefetch")) return true;
	return String(req.get("purpose")).includes("prefetch");
}
