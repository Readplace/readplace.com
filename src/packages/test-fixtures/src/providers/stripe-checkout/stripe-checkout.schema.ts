import { z } from "zod";
import type { CheckoutSessionId } from "@packages/provider-contracts/stripe-checkout";

export const CheckoutSessionIdSchema = z
	.string()
	.min(1)
	.transform((s): CheckoutSessionId => s as CheckoutSessionId);
