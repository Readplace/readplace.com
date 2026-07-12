import { MAX_SAVEABLE_URL_LENGTH, type ValidateSaveableUrl } from "@packages/domain/article";

/** Ambient inputs a preprocessor may need to rewrite a URL, supplied at apply
 * time (not construction) so each preprocessor stays a bare, composable value.
 * `selfHost` is the running app's host (`new URL(appOrigin).host`) — readplace.com
 * in production, localhost:PORT in dev — so it can't be baked into a constant. */
export type UnwrapContext = { selfHost: string };

/** Rewrites a wrapper URL to the underlying article URL, or returns the input
 * unchanged when it doesn't apply. Contract: idempotent, and each application
 * either strictly shortens the URL or leaves it untouched, so a composed group
 * reaches a fixpoint. */
export type UnwrapPreprocessor = (url: string, context: UnwrapContext) => string;

/** Composes unwrap preprocessors into one. Runs the whole set repeatedly until a
 * full pass leaves the URL unchanged, so a URL wrapped by more than one provider
 * (a Readplace reader link around, say, an Apple News link) fully collapses
 * regardless of the order the providers are listed. Termination rests on the
 * per-preprocessor shrink-or-noop contract: a pass that changes nothing ends it. */
export function unwrappedPreProcessors(
	...preprocessors: readonly UnwrapPreprocessor[]
): UnwrapPreprocessor {
	return (url, context) => {
		let current = url;
		for (;;) {
			const passStart = current;
			for (const preprocess of preprocessors) {
				current = preprocess(current, context);
			}
			if (current === passStart) return current;
		}
	};
}

/** Decorates a SaveableUrl validator so it unwraps wrapper URLs before validating.
 * Composed at the composition roots so every save path — every client — mints the
 * brand from the underlying article URL with no per-route code. The length gate
 * sits here, before the rewrite: the validator's own MAX_SAVEABLE_URL_LENGTH rule
 * runs only after preprocessing, too late to bound the unwrap work. An over-length
 * string skips unwrapping and fails validation. */
export function withUnwrapPreprocessing(
	validate: ValidateSaveableUrl,
	preprocess: UnwrapPreprocessor,
	context: UnwrapContext,
): ValidateSaveableUrl {
	return (value) =>
		validate(
			typeof value === "string" && value.length <= MAX_SAVEABLE_URL_LENGTH
				? preprocess(value, context)
				: value,
		);
}
