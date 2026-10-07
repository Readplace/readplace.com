import { unwrapWrapperUrl } from "@packages/domain/article";
import type { ResolveWrapperTarget } from "./resolve-wrapper-target";

export function withSyntacticUnwrap(resolveWrapperTarget: ResolveWrapperTarget): ResolveWrapperTarget {
	return async (url) => {
		const unwrapped = unwrapWrapperUrl(url);
		return unwrapped.url === url ? resolveWrapperTarget(url) : unwrapped;
	};
}
