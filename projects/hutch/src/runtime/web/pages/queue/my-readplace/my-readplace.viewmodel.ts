import { z } from "zod";

export const MAX_READING_PREFERENCE_LENGTH = 2000;

export const MyReadplaceBodySchema = z.object({
	text: z
		.string()
		.transform((value) => value.trim())
		.pipe(z.string().min(1).max(MAX_READING_PREFERENCE_LENGTH)),
});

export type MyReadplaceMode = "compose" | "edit" | "summary";

export interface MyReadplaceViewModel {
	mode: MyReadplaceMode;
	text: string;
	invalid: boolean;
}

export function toMyReadplaceViewModel(input: {
	preference: { text: string } | undefined;
	edit: boolean;
	invalid: boolean;
}): MyReadplaceViewModel {
	if (!input.preference) {
		return { mode: "compose", text: "", invalid: input.invalid };
	}
	return {
		mode: input.edit ? "edit" : "summary",
		text: input.preference.text,
		invalid: input.invalid,
	};
}
