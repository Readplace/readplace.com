import { z } from "zod";

const WRITTEN_DATE = /^(\d{4}-\d{2}-\d{2})(?:$|[T ])/;
const CalendarDateSchema = z.iso.date();

export function publishedOnFrom(raw: string | null | undefined): string | undefined {
	const match = WRITTEN_DATE.exec((raw ?? "").trim());
	if (match === null) return undefined;
	const parsed = CalendarDateSchema.safeParse(match[1]);
	return parsed.success ? parsed.data : undefined;
}
