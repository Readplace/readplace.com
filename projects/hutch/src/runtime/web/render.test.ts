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
});
