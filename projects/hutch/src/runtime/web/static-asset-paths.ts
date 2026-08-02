export const CLIENT_DIST_MOUNT_PATH = "/client-dist";

export const STYLES_MOUNT_PATH = "/styles";

export const APPLE_TOUCH_ICON_PATH = /^\/apple-touch-icon(?:-\d+x\d+)?(?:-precomposed)?\.png$/;

/** express.static responds terminally, so a client-dist asset's finish-time
 * req.path stays mount-trimmed to a root-level `/<name>.client.js` — a shape
 * no reader path can take, because no hostname ends in `.client.js`. */
const TRIMMED_BUNDLE_PATH = /^\/[a-z0-9-]+\.client\.js(\.map)?$/;

/** Deliberately not a bare extension regex: reader paths mirror arbitrary
 * source URLs and may end `.png`/`.html`. */
export function isStaticAssetRequestPath(path: string): boolean {
	if (path === CLIENT_DIST_MOUNT_PATH || path.startsWith(`${CLIENT_DIST_MOUNT_PATH}/`)) return true;
	if (path === STYLES_MOUNT_PATH || path.startsWith(`${STYLES_MOUNT_PATH}/`)) return true;
	if (APPLE_TOUCH_ICON_PATH.test(path)) return true;
	return TRIMMED_BUNDLE_PATH.test(path);
}
