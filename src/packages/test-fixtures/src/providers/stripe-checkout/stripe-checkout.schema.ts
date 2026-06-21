import { z } from "zod";

export const CheckoutSessionIdSchema = z.string().min(1).brand<"CheckoutSessionId">();
