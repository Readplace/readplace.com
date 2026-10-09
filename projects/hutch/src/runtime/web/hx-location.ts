const SWAP_FOR_SCROLL = {
	top: "outerHTML show:none scroll:html:top",
	"stay-put": "outerHTML show:none",
} as const;

export type HxLocationScroll = keyof typeof SWAP_FOR_SCROLL;

export function hxLocationToMain(location: { path: string; source: string; scroll: HxLocationScroll }): string {
	return JSON.stringify({
		path: location.path,
		source: location.source,
		target: "main",
		select: "main",
		swap: SWAP_FOR_SCROLL[location.scroll],
	});
}
