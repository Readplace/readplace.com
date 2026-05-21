import { resolveRelativeUrls } from "./resolve-relative-urls";

describe("resolveRelativeUrls", () => {
	const baseUrl = "https://example.com/blog/my-article";

	it("should resolve relative img src to absolute URL", () => {
		const html = '<img src="/images/photo.jpg">';
		const result = resolveRelativeUrls({ html, baseUrl });
		expect(result).toContain('src="https://example.com/images/photo.jpg"');
	});

	it("should resolve relative anchor href to absolute URL", () => {
		const html = '<a href="/other-article">Link</a>';
		const result = resolveRelativeUrls({ html, baseUrl });
		expect(result).toContain('href="https://example.com/other-article"');
	});

	it("should leave absolute URLs unchanged", () => {
		const html = '<img src="https://cdn.example.com/photo.jpg">';
		const result = resolveRelativeUrls({ html, baseUrl });
		expect(result).toContain('src="https://cdn.example.com/photo.jpg"');
	});

	it("should resolve path-relative URLs", () => {
		const html = '<img src="photo.jpg">';
		const result = resolveRelativeUrls({ html, baseUrl });
		expect(result).toContain(
			'src="https://example.com/blog/photo.jpg"',
		);
	});

	it("should resolve protocol-relative URLs", () => {
		const html = '<img src="//cdn.example.com/photo.jpg">';
		const result = resolveRelativeUrls({ html, baseUrl });
		expect(result).toContain('src="https://cdn.example.com/photo.jpg"');
	});

	it("should resolve single-entry source srcset", () => {
		const html = '<source srcset="/images/photo.webp">';
		const result = resolveRelativeUrls({ html, baseUrl });
		expect(result).toContain(
			'srcset="https://example.com/images/photo.webp"',
		);
	});

	it("should resolve multi-entry srcset with width descriptors", () => {
		const html = '<source srcset="/img/small.jpg 300w, /img/large.jpg 800w">';
		const result = resolveRelativeUrls({ html, baseUrl });
		expect(result).toContain(
			'srcset="https://example.com/img/small.jpg 300w, https://example.com/img/large.jpg 800w"',
		);
	});

	it("should resolve img[srcset] attributes", () => {
		const html = '<img srcset="/img/small.jpg 1x, /img/large.jpg 2x">';
		const result = resolveRelativeUrls({ html, baseUrl });
		expect(result).toContain(
			'srcset="https://example.com/img/small.jpg 1x, https://example.com/img/large.jpg 2x"',
		);
	});

	it("should resolve video[src] and audio[src] attributes", () => {
		const html = '<video src="/media/video.mp4"></video><audio src="/media/audio.mp3"></audio>';
		const result = resolveRelativeUrls({ html, baseUrl });
		expect(result).toContain('src="https://example.com/media/video.mp4"');
		expect(result).toContain('src="https://example.com/media/audio.mp3"');
	});

	it("should handle multiple elements with relative URLs", () => {
		const html = `
			<img src="/img/one.jpg">
			<a href="/page">Link</a>
			<img src="/img/two.jpg">
		`;
		const result = resolveRelativeUrls({ html, baseUrl });
		expect(result).toContain('src="https://example.com/img/one.jpg"');
		expect(result).toContain('href="https://example.com/page"');
		expect(result).toContain('src="https://example.com/img/two.jpg"');
	});

	it("should not modify anchor links (fragment-only hrefs)", () => {
		const html = '<a href="#section">Jump</a>';
		const result = resolveRelativeUrls({ html, baseUrl });
		expect(result).toContain('href="#section"');
	});

	it("should handle empty content", () => {
		const result = resolveRelativeUrls({ html: "", baseUrl });
		expect(result).toBe("");
	});

	it("should preserve empty src attribute unchanged", () => {
		const html = '<img src="">';
		const result = resolveRelativeUrls({ html, baseUrl });
		expect(result).toContain('src=""');
	});

	it("should preserve empty srcset attribute unchanged", () => {
		const html = '<source srcset="">';
		const result = resolveRelativeUrls({ html, baseUrl });
		expect(result).toContain('srcset=""');
	});

	it("should leave malformed absolute URL in src unchanged", () => {
		const html = '<img src="http://[::1">';
		const result = resolveRelativeUrls({ html, baseUrl });
		expect(result).toContain('src="http://[::1"');
	});

	it("should leave malformed URL in srcset without descriptor unchanged", () => {
		const html = '<source srcset="http://[::1">';
		const result = resolveRelativeUrls({ html, baseUrl });
		expect(result).toContain('srcset="http://[::1"');
	});

	it("should leave malformed URL in srcset with descriptor unchanged", () => {
		const html = '<source srcset="http://[::1 300w">';
		const result = resolveRelativeUrls({ html, baseUrl });
		expect(result).toContain("http://[::1");
	});

	it("should preserve absolute srcset URLs that contain commas", () => {
		const html = '<img srcset="https://cdn.example.com/image/fetch/w_424,c_limit,f_webp,q_auto:good/https%3A%2F%2Fmedia.example.com%2Fphoto.png 424w, https://cdn.example.com/image/fetch/w_848,c_limit,f_webp,q_auto:good/https%3A%2F%2Fmedia.example.com%2Fphoto.png 848w">';
		const result = resolveRelativeUrls({ html, baseUrl });
		expect(result).toContain("https://cdn.example.com/image/fetch/w_424,c_limit,f_webp,q_auto:good/https%3A%2F%2Fmedia.example.com%2Fphoto.png 424w");
		expect(result).toContain("https://cdn.example.com/image/fetch/w_848,c_limit,f_webp,q_auto:good/https%3A%2F%2Fmedia.example.com%2Fphoto.png 848w");
	});
});
