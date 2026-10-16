const bodies = new WeakMap<object, Buffer>();

export function captureOAuthBody(request: object, _response: object, body: Buffer): void {
	bodies.set(request, Buffer.from(body));
}

export function oauthRequestBody(request: object): Buffer {
	const body = bodies.get(request);
	if (!body) throw new Error("OAuth request body was not captured");
	return body;
}
