export const CLIENT_DIST_MOUNT_PATH = "/client-dist";

const APPLE_TOUCH_ICON_PATH = /^\/apple-touch-icon(?:-\d+x\d+)?(?:-precomposed)?\.png$/;

/** A one-segment `*.client.js` path can only be a mount-trimmed client-dist
 * bundle: express.static responds terminally, so the router never restores the
 * `/client-dist` prefix onto req.url. A reader permalink is always
 * `/<host>/<slug>` (2+ segments) and no hostname ends in `.js`, so this shape is
 * never a real page — a constraint the express types cannot express. */
const TRIMMED_BUNDLE_PATH = /^\/[a-z0-9-]+\.client\.js(\.map)?$/;

/** True when a request path targets a static asset served outside the page
 * router (the /client-dist mount and the apple-touch-icon redirect in
 * server.ts), so analytics and click-attribution can exclude it. Deliberately
 * not a bare extension regex: reader paths mirror arbitrary source URLs and may
 * end `.png`/`.html`. */
export function isStaticAssetRequestPath(path: string): boolean {
	if (path === CLIENT_DIST_MOUNT_PATH || path.startsWith(`${CLIENT_DIST_MOUNT_PATH}/`)) return true;
	if (APPLE_TOUCH_ICON_PATH.test(path)) return true;
	return TRIMMED_BUNDLE_PATH.test(path);
}
