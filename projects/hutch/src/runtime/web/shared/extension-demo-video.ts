export const EXTENSION_DEMO_WIDTH = 1280;
export const EXTENSION_DEMO_HEIGHT = 800;

const DEMO_PATHS = {
	chrome: {
		h264: "/videos/chrome-save-demo-h264.mp4",
		poster: "/videos/chrome-save-demo-poster.webp",
	},
	firefox: {
		h264: "/videos/firefox-save-demo-h264.mp4",
		poster: "/videos/firefox-save-demo-poster.webp",
	},
} as const;

export type ExtensionDemoBrowser = keyof typeof DEMO_PATHS;

export interface ExtensionDemoSource {
	src: string;
	type: string;
}

export interface ExtensionDemoVideo {
	sources: ExtensionDemoSource[];
	poster: string;
	width: number;
	height: number;
}

export function buildExtensionDemoVideo(
	browser: ExtensionDemoBrowser,
	staticBaseUrl: string,
): ExtensionDemoVideo {
	const paths = DEMO_PATHS[browser];
	return {
		sources: [{ src: `${staticBaseUrl}${paths.h264}`, type: "video/mp4" }],
		poster: `${staticBaseUrl}${paths.poster}`,
		width: EXTENSION_DEMO_WIDTH,
		height: EXTENSION_DEMO_HEIGHT,
	};
}
