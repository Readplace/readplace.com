import { timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import assert from "node:assert";
import { z } from "zod";

const ViewerIpSchema = z.string().brand<"ViewerIp">();
export type ViewerIp = z.infer<typeof ViewerIpSchema>;

export const EDGE_SECRET_HEADER = "x-readplace-edge-secret";
export const VIEWER_IP_HEADER = "x-readplace-viewer-ip";
export const VIEWER_HOST_HEADER = "x-readplace-viewer-host";

export interface ViewerIdentity {
	ip: ViewerIp | undefined;
	host: string | undefined;
}

declare global {
	namespace Express {
		interface Request {
			viewer?: ViewerIdentity;
		}
	}
}

function constantTimeEquals(a: string, b: string): boolean {
	const presented = Buffer.from(a);
	const expected = Buffer.from(b);
	if (presented.length !== expected.length) return false;
	return timingSafeEqual(presented, expected);
}

function headerValue(req: Request, name: string): string | undefined {
	const raw = req.headers[name];
	return typeof raw === "string" && raw !== "" ? raw : undefined;
}

function toViewerIp(value: string | undefined): ViewerIp | undefined {
	return value === undefined ? undefined : ViewerIpSchema.parse(value);
}

/**
 * Behind a CDN the socket address belongs to the edge, so every viewer served by
 * one point of presence would share a rate-limit bucket and an analytics
 * identity. The edge states the viewer's own address in a header instead, trusted
 * only when the request also carries the shared secret the CDN stamps as a custom
 * origin header — something a viewer cannot set. The origin endpoint the CDN
 * forwards to stays publicly reachable, so without that proof anyone could pick
 * their own bucket or dodge a ban by sending the header themselves. No secret, no
 * trust: fall back to the socket address.
 */
export function initResolveViewerIdentity(deps: { edgeSecret: string }) {
	return function resolveViewerIdentity(req: Request): ViewerIdentity {
		const fromSocket: ViewerIdentity = {
			ip: toViewerIp(req.ip),
			host: headerValue(req, "host"),
		};

		const presented = headerValue(req, EDGE_SECRET_HEADER);
		if (presented === undefined) return fromSocket;
		if (!constantTimeEquals(presented, deps.edgeSecret)) return fromSocket;

		const statedIp = toViewerIp(headerValue(req, VIEWER_IP_HEADER));
		const statedHost = headerValue(req, VIEWER_HOST_HEADER);
		return {
			ip: statedIp === undefined ? fromSocket.ip : statedIp,
			host: statedHost === undefined ? fromSocket.host : statedHost,
		};
	};
}

export function viewerOf(req: Request): ViewerIdentity {
	assert(
		req.viewer,
		"viewer-identity middleware must run before a viewer address or host is read",
	);
	return req.viewer;
}
