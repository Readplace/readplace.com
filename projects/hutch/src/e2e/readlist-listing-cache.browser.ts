export interface ListingRead {
	status: number;
	transferSize: number;
}

export async function readListingFromBrowser(url: string): Promise<ListingRead> {
	performance.clearResourceTimings();
	const response = await fetch(url, { credentials: "same-origin" });
	await response.text();
	const entries = performance.getEntriesByName(url, "resource");
	const last = entries[entries.length - 1];
	if (!(last instanceof PerformanceResourceTiming)) {
		throw new Error(`"${url}" must record a resource timing entry to be measured`);
	}
	return { status: response.status, transferSize: last.transferSize };
}

export async function saveArticleFromBrowser(input: {
	saveUrl: string;
	articleUrl: string;
}): Promise<number> {
	const response = await fetch(input.saveUrl, {
		method: "POST",
		credentials: "same-origin",
		redirect: "manual",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({ url: input.articleUrl }).toString(),
	});
	return response.status;
}
