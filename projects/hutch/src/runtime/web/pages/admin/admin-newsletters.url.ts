import { z } from "zod";
import { type NewsletterListStatus, NewsletterListStatusSchema } from "@packages/domain/newsletter-catalog";

export const ADMIN_NEWSLETTERS_PATH = "/admin/newsletters";

export const FROM_CHECKED_FIELDS = ["from", "new_from"] as const;
export type FromCheckedField = (typeof FROM_CHECKED_FIELDS)[number];

export const AdminNewslettersNoticeSchema = z.enum([
	"created",
	"updated",
	"approved",
	"rejected",
	"withdrawn",
	"reconsidered",
	"corrected",
	"seeded",
]);
export type AdminNewslettersNotice = z.infer<typeof AdminNewslettersNoticeSchema>;

export interface AdminNewslettersListState {
	listStatus: NewsletterListStatus;
	q: string;
	page: number;
}

export function formFields<Schema extends z.ZodType>(schema: Schema) {
	return z.preprocess((value) => value ?? {}, schema);
}

const ListStateSchema = formFields(
	z.object({
		list_status: NewsletterListStatusSchema.catch("pending"),
		q: z.string().trim().catch(""),
		page: z.coerce.number().int().min(1).catch(1),
	}),
);

export function parseAdminNewslettersListState(source: unknown): AdminNewslettersListState {
	const parsed = ListStateSchema.parse(source);
	return { listStatus: parsed.list_status, q: parsed.q, page: parsed.page };
}

export function adminNewslettersListFields(state: AdminNewslettersListState): { name: string; value: string }[] {
	return [
		{ name: "list_status", value: state.listStatus },
		{ name: "q", value: state.q },
		{ name: "page", value: String(state.page) },
	];
}

export function buildAdminNewslettersUrl(input: { state: AdminNewslettersListState; notice: AdminNewslettersNotice | undefined }): string {
	const params = new URLSearchParams({ list_status: input.state.listStatus });
	if (input.state.q !== "") params.set("q", input.state.q);
	if (input.state.page > 1) params.set("page", String(input.state.page));
	if (input.notice !== undefined) params.set("notice", input.notice);
	return `${ADMIN_NEWSLETTERS_PATH}?${params.toString()}`;
}
