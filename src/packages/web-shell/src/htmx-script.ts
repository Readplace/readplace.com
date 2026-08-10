/** htmx's config travels in the `<meta>` htmx reads during init rather than an
 * inline script, which is what lets the bundle tag stay deferred. A site picks
 * one of the two values below; there is no third shape, so nothing branches. */
export interface HtmxDelivery {
	readonly configMeta: string;
	readonly script: string;
}

export const HtmxLoaded: HtmxDelivery = {
	configMeta: `<meta name="htmx-config" content='{"scrollBehavior":"smooth"}'>`,
	script: `<script src="/client-dist/htmx.client.js" defer></script>`,
};

/** `/client-dist` is hutch's mount. A site that renders no `hx-*` attributes
 * takes this instead, so it never emits a tag its own origin cannot answer. */
export const HtmxOmitted: HtmxDelivery = { configMeta: "", script: "" };
