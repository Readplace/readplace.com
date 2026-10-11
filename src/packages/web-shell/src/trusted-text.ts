import { z } from "zod";

const HtmlTextSchema = z.string().brand<"HtmlText">();
const PlainTextSchema = z.string().brand<"PlainText">();

export type HtmlText = z.infer<typeof HtmlTextSchema>;
export type PlainText = z.infer<typeof PlainTextSchema>;

export function htmlText(value: string): HtmlText {
	return HtmlTextSchema.parse(value);
}

export function plainText(value: string): PlainText {
	return PlainTextSchema.parse(value);
}
