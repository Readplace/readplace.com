import assert from "node:assert";
import {
	formatReaderImageSize,
	READER_IMAGE_SIZE_ATTRIBUTE,
	type ReaderImageSize,
} from "@packages/domain/article";
import type { DownloadedMedia } from "@packages/finalize-article";
import { parseHTML } from "linkedom";
import parseSrcset from "parse-srcset";

const ANY_CASE_SIZE_ATTRIBUTE = new RegExp(READER_IMAGE_SIZE_ATTRIBUTE, "i");

type MeasuredSize = { width: number; height: number };

type SizeByCdnUrl = ReadonlyMap<string, MeasuredSize>;

type ScaledSource = { url: string; scale: number };

type MeasuredSource = { size: MeasuredSize; scale: number };

function sourceSizeOf(sizes: string | null): string | undefined {
	if (sizes === null) return "100vw";
	const trimmed = sizes.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, "");
	if (trimmed === "100vw") return "100vw";
	const fixed = /^([1-9]\d{0,4})px$/.exec(trimmed);
	if (fixed) return `${fixed[1]}px`;
	const capped = /^\(max-width:\s*([1-9]\d{0,4})px\)\s+100vw,\s*([1-9]\d{0,4})px$/i.exec(trimmed);
	if (capped && capped[1] === capped[2]) return `min(100vw,${capped[1]}px)`;
	return undefined;
}

function measureAll(sources: ScaledSource[], sizeByCdnUrl: SizeByCdnUrl): MeasuredSource[] | undefined {
	const measured = sources.flatMap((source) => {
		const size = sizeByCdnUrl.get(source.url);
		return size ? [{ size, scale: source.scale }] : [];
	});
	return measured.length === sources.length ? measured : undefined;
}

function largestScale(sources: MeasuredSource[]): MeasuredSource {
	return sources.reduce((largest, source) => (source.scale > largest.scale ? source : largest));
}

function widthDescribedSize(params: {
	sources: ScaledSource[];
	sizes: string | null;
	sizeByCdnUrl: SizeByCdnUrl;
}): ReaderImageSize | undefined {
	const measured = measureAll(params.sources, params.sizeByCdnUrl);
	if (!measured || measured.some(({ size, scale }) => size.width !== scale)) return undefined;
	const reference = largestScale(measured).size;
	const keepsRatio = measured.every(
		({ size }) => Math.abs(size.height - (size.width * reference.height) / reference.width) <= 0.5,
	);
	const sourceSize = sourceSizeOf(params.sizes);
	if (!keepsRatio || sourceSize === undefined) return undefined;
	return { width: reference.width, height: reference.height, sourceSize };
}

function densityDescribedSize(params: {
	sources: ScaledSource[];
	src: string | null;
	sizeByCdnUrl: SizeByCdnUrl;
}): ReaderImageSize | undefined {
	const sourceSet =
		params.src && !params.sources.some(({ scale }) => scale === 1)
			? [...params.sources, { url: params.src, scale: 1 }]
			: params.sources;
	const measured = measureAll(sourceSet, params.sizeByCdnUrl);
	if (!measured) return undefined;
	const [first] = measured;
	const width = first.size.width / first.scale;
	const reference = largestScale(measured);
	const height = Math.round(reference.size.height / reference.scale);
	const consistent = measured.every(
		({ size, scale }) => size.width / scale === width && Math.abs(size.height / scale - height) <= 0.5,
	);
	return consistent ? { width, height } : undefined;
}

function measuredImageSize(params: {
	src: string | null;
	srcset: string;
	sizes: string | null;
	sizeByCdnUrl: SizeByCdnUrl;
}): ReaderImageSize | undefined {
	const candidates = parseSrcset(params.srcset);
	if (candidates.some(({ h }) => h !== undefined)) return undefined;
	if (candidates.length === 0) return params.sizeByCdnUrl.get(params.src ?? "");
	const widthDescribed = candidates.flatMap(({ url, w }) => (w === undefined ? [] : [{ url, scale: w }]));
	if (widthDescribed.length === candidates.length) {
		return widthDescribedSize({ sources: widthDescribed, sizes: params.sizes, sizeByCdnUrl: params.sizeByCdnUrl });
	}
	if (widthDescribed.length > 0) return undefined;
	return densityDescribedSize({
		sources: candidates.map(({ url, d }) => ({ url, scale: d ?? 1 })),
		src: params.src,
		sizeByCdnUrl: params.sizeByCdnUrl,
	});
}

export function recordMeasuredImageSizes(params: { html: string; media: DownloadedMedia[] }): string {
	const sizeByCdnUrl: SizeByCdnUrl = new Map(
		params.media.flatMap(({ cdnUrl, dimensions }) => (dimensions ? [[cdnUrl, dimensions] as const] : [])),
	);
	if (sizeByCdnUrl.size === 0 && !ANY_CASE_SIZE_ATTRIBUTE.test(params.html)) return params.html;

	const { document } = parseHTML(`<div id="root">${params.html}</div>`);
	const root = document.getElementById("root");
	assert(root, "parseHTML('<div id=\"root\">...') must produce the root div");
	let changed = false;
	root.querySelectorAll("img").forEach((img) => {
		img
			.getAttributeNames()
			.filter((name) => name.toLowerCase() === READER_IMAGE_SIZE_ATTRIBUTE)
			.forEach((name) => {
				img.removeAttribute(name);
				changed = true;
			});
		const size = measuredImageSize({
			src: img.getAttribute("src"),
			srcset: img.getAttribute("srcset") ?? "",
			sizes: img.getAttribute("sizes"),
			sizeByCdnUrl,
		});
		const stored = size && formatReaderImageSize(size);
		if (stored !== undefined) {
			img.setAttribute(READER_IMAGE_SIZE_ATTRIBUTE, stored);
			changed = true;
		}
	});
	return changed ? root.innerHTML : params.html;
}
