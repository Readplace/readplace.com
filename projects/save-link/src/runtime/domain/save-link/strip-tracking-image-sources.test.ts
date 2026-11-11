import { stripTrackingImageSources } from "./strip-tracking-image-sources";

const FACEBOOK_PIXEL = "https://www.facebook.com/tr?id=1&amp;ev=PageView";
const HOTSTAR_EVENT = "https://hspx.hotstar.com/v1/events/track/cp_page_view?pi=synthetic";
const SEC_PIXEL = "https://www.sec.gov/akam/13/pixel_0a1b2c3d";

describe("stripTrackingImageSources", () => {
	it("returns the body byte-for-byte when it references no evidenced tracking endpoint", () => {
		const html = '<p>Logo <img src="https://example.com/logo.svg" alt="Logo"> and <a href="https://www.facebook.com/tr?id=1">a link</a></p>';

		expect(stripTrackingImageSources(html)).toBe(html);
	});

	it("removes a standalone beacon img but keeps the surrounding text, captions and hyperlinks", () => {
		const html = `<figure><img src="${FACEBOOK_PIXEL}" width="1" height="1"><figcaption>See <a href="https://www.facebook.com/tr?id=2">the pixel</a></figcaption></figure>`;

		expect(stripTrackingImageSources(html)).toBe(
			'<figure><figcaption>See <a href="https://www.facebook.com/tr?id=2">the pixel</a></figcaption></figure>',
		);
	});

	it("drops a beacon src but keeps the img when its own srcset still has an allowed rendition", () => {
		const html = `<img src="${SEC_PIXEL}" srcset="https://example.com/photo-640.jpg 640w" alt="Photo">`;

		expect(stripTrackingImageSources(html)).toBe('<img srcset="https://example.com/photo-640.jpg 640w" alt="Photo">');
	});

	it("drops only the beacon entries of a mixed srcset and keeps each allowed rendition's descriptors", () => {
		const html = `<img src="https://example.com/photo.jpg" srcset="https://example.com/a.jpg 640w, ${HOTSTAR_EVENT} 2x, https://example.com/b.jpg 2x, https://example.com/c.jpg 300w 200h, https://example.com/d.jpg">`;

		expect(stripTrackingImageSources(html)).toBe(
			'<img src="https://example.com/photo.jpg" srcset="https://example.com/a.jpg 640w, https://example.com/b.jpg 2x, https://example.com/c.jpg 300w 200h, https://example.com/d.jpg">',
		);
	});

	it("removes an all-beacon srcset and keeps the img on its allowed src", () => {
		const html = `<img src="https://example.com/photo.jpg" srcset="${SEC_PIXEL} 1x">`;

		expect(stripTrackingImageSources(html)).toBe('<img src="https://example.com/photo.jpg">');
	});

	it("removes an img whose src and srcset are all beacons, never leaving an empty src", () => {
		const html = `<p>Before</p><img src="${FACEBOOK_PIXEL}" srcset="${SEC_PIXEL} 1x"><p>After</p>`;

		expect(stripTrackingImageSources(html)).toBe("<p>Before</p><p>After</p>");
	});

	it("returns a body with no img or source element unchanged", () => {
		const html = `<p>See ${FACEBOOK_PIXEL}</p><table><tr><td>cell</td></tr></table>`;

		expect(stripTrackingImageSources(html)).toBe(html);
	});

	it("keeps a picture's valid sibling sources and gives its fallback img the first remaining rendition as src", () => {
		const html =
			"<picture>" +
			`<source srcset="${SEC_PIXEL}">` +
			`<source srcset="https://example.com/figure.webp 1x, ${HOTSTAR_EVENT} 2x" type="image/webp">` +
			`<img src="${FACEBOOK_PIXEL}" alt="Figure">` +
			"</picture>";

		expect(stripTrackingImageSources(html)).toBe(
			'<picture><source srcset="https://example.com/figure.webp 1x" type="image/webp"><img src="https://example.com/figure.webp" alt="Figure"></picture>',
		);
	});

	it("removes a picture's img when every source in the picture was a beacon", () => {
		const html = `<picture><source srcset="${SEC_PIXEL}"><img src="${FACEBOOK_PIXEL}"></picture><p>Caption text</p>`;

		expect(stripTrackingImageSources(html)).toBe("<picture></picture><p>Caption text</p>");
	});
});
