import { type DemoVideo, buildDemoVideo } from "./demo-video";

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

export function buildExtensionDemoVideo(
	browser: ExtensionDemoBrowser,
	staticBaseUrl: string,
): DemoVideo {
	return buildDemoVideo(
		{ ...DEMO_PATHS[browser], width: EXTENSION_DEMO_WIDTH, height: EXTENSION_DEMO_HEIGHT },
		staticBaseUrl,
	);
}
