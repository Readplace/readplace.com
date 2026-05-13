declare module "@11ty/posthtml-urls" {
	interface PostHTMLUrlsOptions {
		eachURL: (url: string, attr: string, tag: string, node: { attrs: Record<string, string> }) => string;
		filter?: Record<string, Record<string, boolean | ((node: unknown) => boolean)>>;
	}
	function urls(options: PostHTMLUrlsOptions): (tree: unknown) => Promise<unknown>;
	export = urls;
}
