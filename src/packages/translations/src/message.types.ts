export type PluralForms = { readonly one: string; readonly other: string };

export type MessageTree = { readonly [key: string]: string | MessageTree };

export type Placeholders<S extends string> = S extends `${string}{${infer N}}${infer R}` ? N | Placeholders<R> : never;

export type Params<S> = S extends string
	? [Placeholders<S>] extends [never]
		? []
		: [params: { readonly [P in Placeholders<S>]: string | number }]
	: never;

type SamePlaceholders<S extends string> = S extends `${string}{${infer N}}${infer R}`
	? `${string}{${N}}${string}` & SamePlaceholders<R>
	: string;

export type LocaleOf<M> = {
	readonly [K in keyof M]: M[K] extends string
		? SamePlaceholders<M[K]>
		: M[K] extends PluralForms
			? { readonly [F in keyof M[K]]: M[K][F] extends string ? SamePlaceholders<M[K][F]> : never }
			: LocaleOf<M[K]>;
};

export type NonEmptyLeaves<M> = {
	readonly [K in keyof M]: M[K] extends "" ? never : M[K] extends string ? M[K] : NonEmptyLeaves<M[K]>;
};

type Join<K extends string, P extends string> = [P] extends [never] ? never : `${K}.${P}`;

export type LeafPath<M> = {
	[K in keyof M & string]: M[K] extends string ? K : M[K] extends PluralForms ? never : Join<K, LeafPath<M[K]>>;
}[keyof M & string];

export type PluralPath<M> = {
	[K in keyof M & string]: M[K] extends string ? never : M[K] extends PluralForms ? K : Join<K, PluralPath<M[K]>>;
}[keyof M & string];

export type MessageAt<M, P extends string> = P extends `${infer H}.${infer R}`
	? H extends keyof M
		? MessageAt<M[H], R>
		: never
	: P extends keyof M
		? M[P]
		: never;

export type PluralParams<F> = F extends PluralForms
	? { readonly count: number } & {
			readonly [P in Exclude<Placeholders<F["one"]> | Placeholders<F["other"]>, "count">]: string | number;
		}
	: never;
