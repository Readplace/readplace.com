import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import { gatewayRequestIdOf } from "./gateway-request-id";

function incomingRequest(properties: Record<string, unknown>): IncomingMessage {
	return Object.assign(new IncomingMessage(new Socket()), properties);
}

describe("gatewayRequestIdOf", () => {
	it("returns the id API Gateway assigned the invocation — the same value its access log records as $context.requestId — read off the request object the Lambda adapter attaches it to", () => {
		const req = incomingRequest({ requestContext: { requestId: "ClSmAj_bSwMEPuQ=" } });
		expect(gatewayRequestIdOf(req)).toBe("ClSmAj_bSwMEPuQ=");
	});

	it("reads only the adapter-attached invocation context and never a header, so no client-supplied id is mistaken for the gateway's — the property it reads cannot be set from the wire, which is what makes the dev server and the test app unforgeable too", () => {
		const req = incomingRequest({});
		req.headers = { "x-gateway-request-id": "forged", "x-request-id": "forged" };
		expect(gatewayRequestIdOf(req)).toBeUndefined();
	});
});
