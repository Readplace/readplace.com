import type { ResolveWrapperTarget } from "./resolve-wrapper-target";

export function initResolveWrapperTargetOnce(resolve: ResolveWrapperTarget): ResolveWrapperTarget {
	const resolutions = new Map<string, ReturnType<ResolveWrapperTarget>>();
	return (url) => {
		const known = resolutions.get(url);
		if (known !== undefined) return known;
		const resolution = resolve(url);
		resolutions.set(url, resolution);
		resolution.catch(() => resolutions.delete(url));
		return resolution;
	};
}
