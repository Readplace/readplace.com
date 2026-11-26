import type { NativeClientPlatform } from "../onboarding/native-client";
import { type DemoVideo, buildDemoVideo } from "./demo-video";

interface ShareDemoAsset {
	h264: string;
	poster: string;
	width: number;
	height: number;
}

const DEMO_ASSETS = {
	ios: {
		h264: "/videos/ios-share-demo-h264.mp4",
		poster: "/videos/ios-share-demo-poster.webp",
		width: 540,
		height: 1174,
	},
	android: {
		h264: "/videos/android-share-demo-h264.mp4",
		poster: "/videos/android-share-demo-poster.webp",
		width: 540,
		height: 1212,
	},
} as const satisfies Record<NativeClientPlatform, ShareDemoAsset>;

export function buildShareDemoVideo(
	platform: NativeClientPlatform,
	staticBaseUrl: string,
): DemoVideo {
	return buildDemoVideo(DEMO_ASSETS[platform], staticBaseUrl);
}
