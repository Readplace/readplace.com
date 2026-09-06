import { z } from "zod";

export const APPEARANCE_PREFERENCES = ["system", "light", "dark"] as const;

export const AppearancePreferenceSchema = z.enum(APPEARANCE_PREFERENCES);

export type AppearancePreference = z.infer<typeof AppearancePreferenceSchema>;
