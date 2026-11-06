import { type DisplayableReadTime, type EnclosureRead, displayableReadTime } from "@packages/domain/article";

export function displayableTime(input: {
	article: Parameters<typeof displayableReadTime>[0];
	enclosure: EnclosureRead;
}): DisplayableReadTime | undefined {
	if (input.enclosure.kind === "absent") return displayableReadTime(input.article);
	const minutes = String(Math.ceil(input.enclosure.enclosure.durationSeconds / 60));
	return { value: minutes, label: `${minutes} min listen` };
}
