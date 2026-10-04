import { unwrapWrapperUrl } from "@packages/domain/article";
import type { ResolveWrapperTarget } from "./resolve-wrapper-target";

export function withSyntacticUnwrap(resolveWrapperTarget: ResolveWrapperTarget): ResolveWrapperTarget {
	return async (url) => {
		const unwrapped = unwrapWrapperUrl(url).url;
		return unwrapped === url ? resolveWrapperTarget(url) : unwrapped;
	};
}
