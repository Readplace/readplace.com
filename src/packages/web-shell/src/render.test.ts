import { render } from "./render";

describe("render", () => {
	it("should interpolate data into a Handlebars template", () => {
		const result = render("<p>{{name}}</p>", { name: "Alice" });
		expect(result).toBe("<p>Alice</p>");
	});

	it("should HTML-escape interpolated values", () => {
		const result = render("<p>{{content}}</p>", {
			content: '<script>alert("xss")</script>',
		});
		expect(result).toContain("&lt;script&gt;");
	});

	it("should return the same output on repeated calls with the same template", () => {
		const template = "<h1>{{title}}</h1>";
		const first = render(template, { title: "Hello" });
		const second = render(template, { title: "World" });

		expect(first).toBe("<h1>Hello</h1>");
		expect(second).toBe("<h1>World</h1>");
	});

	it("should handle {{#if}} conditionals", () => {
		const template = "{{#if visible}}<p>shown</p>{{/if}}";
		expect(render(template, { visible: true })).toBe("<p>shown</p>");
		expect(render(template, { visible: false })).toBe("");
	});

	it("should handle {{#each}} loops", () => {
		const template = "<ul>{{#each items}}<li>{{this}}</li>{{/each}}</ul>";
		const result = render(template, { items: ["a", "b"] });
		expect(result).toBe("<ul><li>a</li><li>b</li></ul>");
	});

	it("{{track}} stamps internal-click UTM params onto a literal href; Handlebars HTML-escapes the attribute (& → &amp;, = → &#x3D;), which the browser decodes back to a normal query string", () => {
		const result = render("<a href=\"{{track '/account' source='queue' content='subscribe'}}\">Subscribe</a>", {});
		expect(result).toBe(
			'<a href="/account?utm_source&#x3D;queue&amp;utm_medium&#x3D;internal&amp;utm_content&#x3D;subscribe">Subscribe</a>',
		);
	});

	it("{{track}} leaves an absolute external href untouched so analytics params never leak off-site", () => {
		const result = render("<a href=\"{{track 'https://github.com/Readplace/readplace.com' source='home-hero' content='github'}}\">GitHub</a>", {});
		expect(result).toBe('<a href="https://github.com/Readplace/readplace.com">GitHub</a>');
	});

	it("registers caller-provided helpers for that render call", () => {
		const result = render("<p>{{shout text}}</p>", { text: "hi" }, {
			helpers: { shout: (value: string) => value.toUpperCase() },
		});
		expect(result).toBe("<p>HI</p>");
	});
});
