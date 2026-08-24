import type { IncomingMessage } from "node:http";
import { z } from "zod";

const GatewayInvokedRequestSchema = z.object({
	requestContext: z.object({ requestId: z.string().min(1) }),
});

export function gatewayRequestIdOf(req: IncomingMessage): string | undefined {
	const parsed = GatewayInvokedRequestSchema.safeParse(req);
	return parsed.success ? parsed.data.requestContext.requestId : undefined;
}
