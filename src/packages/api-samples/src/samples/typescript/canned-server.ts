import assert from "node:assert";
import { createServer, type IncomingHttpHeaders } from "node:http";

export interface CannedResponse {
	status: number;
	headers?: Record<string, string>;
	body?: string;
}

interface RecordedRequest {
	method: string;
	path: string;
	headers: IncomingHttpHeaders;
	body: string;
}

export interface CannedServer {
	origin: string;
	requests: RecordedRequest[];
	close: () => Promise<void>;
}

export async function startCannedServer(routes: Record<string, CannedResponse>): Promise<CannedServer> {
	const requests: RecordedRequest[] = [];
	const server = createServer((request, response) => {
		const chunks: Buffer[] = [];
		request.on("data", (chunk: Buffer) => chunks.push(chunk));
		request.on("end", () => {
			const method = String(request.method);
			const path = String(request.url);
			requests.push({ method, path, headers: request.headers, body: Buffer.concat(chunks).toString("utf8") });
			const canned = routes[`${method} ${path}`];
			assert(canned, `no canned response for ${method} ${path}`);
			response.writeHead(canned.status, canned.headers);
			response.end(canned.body);
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	assert(address !== null && typeof address === "object", "the canned server has no TCP address");
	return {
		origin: `http://127.0.0.1:${address.port}`,
		requests,
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
	};
}
