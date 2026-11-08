import type { MediaKindManifest } from "@packages/media-contracts";
import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchIntegrations } from "@packages/translations/hutch-integrations";

const { t } = translator(hutchIntegrations, DEFAULT_LOCALE);
const either = new Intl.ListFormat(DEFAULT_LOCALE, { type: "disjunction" });

export function uploadHeadingOf(kinds: readonly MediaKindManifest[]): string {
	return t("upload.heading", {
		kinds: either.format(
			kinds.map((kind) => t(`upload.kinds.${kind.name}.noun`)),
		),
	});
}

export function uploadDescriptionsOf(
	kinds: readonly MediaKindManifest[],
): string[] {
	return kinds.map((kind) =>
		t(`upload.kinds.${kind.name}.description`, { ceiling: kind.ceilingLabel }),
	);
}

export function uploadFormatsOf(kinds: readonly MediaKindManifest[]): string {
	return either.format(kinds.map((kind) => t(`upload.kinds.${kind.name}.format`)));
}

export function unsupportedTypeMessageOf(
	kinds: readonly MediaKindManifest[],
): string {
	return t("upload.unsupportedType", { formats: uploadFormatsOf(kinds) });
}

export function transcriptAllowanceCopyOf(input: { withVideo: boolean; minutes: number }): string {
	return t(input.withVideo ? "upload.transcriptAllowance.audioAndVideo" : "upload.transcriptAllowance.audio", {
		minutes: input.minutes,
	});
}
