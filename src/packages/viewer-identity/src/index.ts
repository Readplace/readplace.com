export {
	EDGE_SECRET_HEADER,
	VIEWER_HOST_HEADER,
	VIEWER_IP_HEADER,
	type ViewerIdentity,
	type ViewerIp,
	viewerOf,
} from "./viewer-identity";
export { createViewerIdentityMiddleware } from "./viewer-identity.middleware";
