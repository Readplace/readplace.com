import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PageBody } from "../../page-body.types";
import { render } from "../../render";
import { BLOG_STYLES } from "./blog.styles";
import type { BlogPost } from "./blog.posts";

const BLOG_POST_TEMPLATE = readFileSync(join(__dirname, "blog-post.template.html"), "utf-8");

export function BlogPostPage(params: { post: BlogPost }): PageBody {
	const { post } = params;

	return {
		seo: {
			title: `${post.title} — Readplace Blog`,
			description: post.description,
			canonicalUrl: `https://readplace.com/blog/${post.slug}`,
			ogType: "article",
			author: post.author,
			keywords: post.keywords,
			structuredData: [
				{
					"@context": "https://schema.org",
					"@type": "BlogPosting",
					headline: post.title,
					description: post.description,
					datePublished: post.date,
					dateModified: post.date,
					author: {
						"@type": "Person",
						name: post.author,
						url: "https://www.linkedin.com/in/fagnerbrack/",
					},
					url: `https://readplace.com/blog/${post.slug}`,
					mainEntityOfPage: {
						"@type": "WebPage",
						"@id": `https://readplace.com/blog/${post.slug}`,
					},
					publisher: {
						"@type": "Organization",
						name: "Readplace",
						url: "https://readplace.com",
					},
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
						{
							"@type": "ListItem",
							position: 3,
							name: post.title,
							item: `https://readplace.com/blog/${post.slug}`,
						},
					],
				},
			],
		},
		styles: BLOG_STYLES,
		bodyClass: "page-blog-post",
		content: render(BLOG_POST_TEMPLATE, {
			title: post.title,
			date: post.date,
			formattedDate: post.formattedDate,
			author: post.author,
			htmlContent: post.htmlContent,
		}),
		markdownContent: post.markdownContent,
		markdownFormattedDate: post.formattedDate,
	};
}
