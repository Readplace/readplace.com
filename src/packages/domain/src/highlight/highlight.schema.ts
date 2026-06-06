import { z } from "zod";
import type { HighlightId } from "./highlight.types";

export const HighlightIdSchema = z.string().transform((s: string): HighlightId => s as HighlightId);
