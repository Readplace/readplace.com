import type { PageBody } from "../../page-body.types";
import { RECRAWL_STYLES } from "./recrawl.styles";

/**
 * Minimal landing for the operator. Submits a URL to /admin/recrawl which
 * redirects to /admin/recrawl/:url and triggers a fresh crawl on every hit.
 */
export function AdminRecrawlLandingPage(): PageBody {
	const content = `
    <main class="admin-recrawl" data-test-admin-recrawl-landing>
      <h1>Admin recrawl</h1>
      <p>Forces a fresh re-crawl of any URL already in the articles DB. No caching, no TTL.</p>
      <form method="GET" action="/admin/recrawl" data-test-admin-recrawl-form>
        <label for="admin-recrawl-url">Article URL</label>
        <input
          id="admin-recrawl-url"
          type="url"
          name="url"
          required
          placeholder="https://example.com/article"
          data-test-admin-recrawl-input>
        <button type="submit">Recrawl</button>
      </form>
    </main>`;

	return {
		seo: {
			title: "Admin recrawl | Readplace",
			description: "Operator endpoint. Not for public consumption.",
			canonicalUrl: "/admin/recrawl",
			robots: "noindex, nofollow",
		},
		styles: RECRAWL_STYLES,
		bodyClass: "page-admin-recrawl",
		content,
	};
}
