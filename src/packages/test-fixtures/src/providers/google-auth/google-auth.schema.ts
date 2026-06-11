import { z } from "zod";
import type { GoogleId } from "@packages/provider-contracts/google-auth";

export type { GoogleId };

export const GoogleIdSchema = z.string().transform((s): GoogleId => s as GoogleId);
