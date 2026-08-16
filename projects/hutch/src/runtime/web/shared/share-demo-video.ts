/** The single recording of the iPhone share flow — open a page, tap Share,
 * favourite Readplace so it leads the row, then save. Two surfaces show it:
 * /install sells it to someone who has not installed the app, and the in-app
 * help page teaches it to someone who has. Only the asset is shared; each
 * surface keeps its own framing copy, as its screenshots already did.
 *
 * One H.264 source, not the homepage's AV1-then-H.264 pair: every committed AV1
 * twin in static-assets/videos is 1.57–1.73x LARGER than its H.264 counterpart,
 * so the second encode costs bytes and buys nothing. */

const H264_PATH = "/videos/ios-share-demo-h264.mp4";
const POSTER_PATH = "/videos/ios-share-demo-poster.webp";

/** The encode target, not a measurement of whatever was recorded: the source is
 * scaled to exactly this. Height follows from the 1206x2622 capture at width
 * 540, so a re-record on a differently-shaped device changes these two numbers
 * and the tests that pin them. */
export const SHARE_DEMO_WIDTH = 540;
export const SHARE_DEMO_HEIGHT = 1174;

export interface ShareDemoSource {
	src: string;
	type: string;
}

export interface ShareDemoVideo {
	sources: ShareDemoSource[];
	poster: string;
	width: number;
	height: number;
}

export function buildShareDemoVideo(staticBaseUrl: string): ShareDemoVideo {
	return {
		sources: [{ src: `${staticBaseUrl}${H264_PATH}`, type: "video/mp4" }],
		poster: `${staticBaseUrl}${POSTER_PATH}`,
		width: SHARE_DEMO_WIDTH,
		height: SHARE_DEMO_HEIGHT,
	};
}
