import assert from "node:assert";
import type {
	SelectRelatedArticles,
	SelectRelatedArticlesParams,
} from "./related-articles-selector";

interface DescribedPage {
	title: string;
	siteName: string;
	description: string;
}

function textKeyOf(page: DescribedPage): string {
	const collapse = (text: string) =>
		text.replace(/\s+/g, " ").trim().toLowerCase();
	return `${collapse(page.title)}\n${collapse(page.description)}`;
}

function hostOf(page: DescribedPage): string {
	return page.siteName.toLowerCase();
}

function hostsByText(
	pages: readonly DescribedPage[],
): ReadonlyMap<string, ReadonlySet<string>> {
	const map = new Map<string, Set<string>>();
	for (const page of pages) {
		const key = textKeyOf(page);
		const hosts = map.get(key) ?? new Set<string>();
		hosts.add(hostOf(page));
		map.set(key, hosts);
	}
	return map;
}

/** A text served verbatim by two different sites is an access wall or error
 * page, not an article: no article's title and description appear on two
 * hosts, while a block page's whole job is to answer many URLs with one body.
 * Re-derived from the rows each computation reads, so a later, better crawl
 * of the same save clears it without anything to unlearn. */
export function initSelectRelatedArticlesWithoutSharedBoilerplate(deps: {
	selectRelatedArticles: SelectRelatedArticles;
}): { selectRelatedArticles: SelectRelatedArticles } {
	const selectRelatedArticles: SelectRelatedArticles = async (params) => {
		const known = hostsByText([
			params.target,
			...params.unreadCandidates,
			...params.readCandidates,
		]);
		const isSharedAcrossSites = (page: DescribedPage) => {
			const hosts = known.get(textKeyOf(page));
			assert(hosts, "every page this checks was indexed above");
			return [...hosts].some((host) => host !== hostOf(page));
		};

		if (isSharedAcrossSites(params.target)) {
			return { kind: "shared-boilerplate" };
		}

		const filtered: SelectRelatedArticlesParams = {
			target: params.target,
			unreadCandidates: params.unreadCandidates.filter(
				(candidate) => !isSharedAcrossSites(candidate),
			),
			readCandidates: params.readCandidates.filter(
				(candidate) => !isSharedAcrossSites(candidate),
			),
		};
		return deps.selectRelatedArticles(filtered);
	};

	return { selectRelatedArticles };
}
