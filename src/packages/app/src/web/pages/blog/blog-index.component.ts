import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PageBody } from "../../page-body.types";
import { render } from "../../render";
import { BLOG_STYLES } from "./blog.styles";
import type { BlogPost } from "./blog.posts";

const BLOG_INDEX_TEMPLATE = readFileSync(join(__dirname, "blog-index.template.html"), "utf-8");

export function BlogIndexPage(params: { posts: BlogPost[] }): PageBody {
	return {
		seo: {
			title: "Blog — Readplace",
			description:
				"Articles about reading, building software, and the tools behind Readplace.",
			canonicalUrl: "https://readplace.com/blog",
			ogType: "website",
			structuredData: [
				{
					"@context": "https://schema.org",
					"@type": "Blog",
					name: "Readplace Blog",
					url: "https://readplace.com/blog",
					description:
						"Articles about reading, building software, and the tools behind Readplace.",
					publisher: {
						"@type": "Organization",
						name: "Readplace",
						url: "https://readplace.com",
					},
					blogPost: params.posts.map((post) => ({
						"@type": "BlogPosting",
						headline: post.title,
						description: post.description,
						datePublished: post.date,
						url: `https://readplace.com/blog/${post.slug}`,
						author: { "@type": "Person", name: post.author },
					})),
				},
				{
					"@context": "https://schema.org",
					"@type": "BreadcrumbList",
					itemListElement: [
						{
							"@type": "ListItem",
							position: 1,
							name: "Home",
							item: "https://readplace.com/",
						},
						{
							"@type": "ListItem",
							position: 2,
							name: "Blog",
							item: "https://readplace.com/blog",
						},
					],
				},
			],
		},
		styles: BLOG_STYLES,
		bodyClass: "page-blog",
		content: render(BLOG_INDEX_TEMPLATE, { posts: params.posts }),
	};
}
