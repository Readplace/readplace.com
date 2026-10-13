const STOP_WORDS = new Set(`the a an and or of to in on for with from by as at is are was were be been it its this that these those both
about into over under than then their there they them his her our your you we he she not but also how why what when who
which while more most less very can could would should will just only one two new other another same each between
through after before during via vs has have had does did do all any some such out up down off own so too no nor
yet if because until whose whom where here now ever never always often still even much many few lot lots get gets got
make makes made like way ways thing things take takes use uses used using look looks see sees seen piece pieces article
articles side story stories
says said news inc ltd com www http https html blog post posts read reading guide intro introduction part first last
year years time times day days week`.split(/\s+/));
const SHORT_WORDS = new Set("ai ml js ts ui ux os vr eu uk c# f# go".split(" "));

export function contentWords(text: string): Set<string> {
	const words = new Set<string>();
	for (let word of text.toLowerCase().match(/[a-z0-9+#]+/g) ?? []) {
		if (STOP_WORDS.has(word) || word.length === 1) continue;
		if (word.length === 2 && !/\d/.test(word) && !SHORT_WORDS.has(word)) continue;
		if (word.length > 4 && word.endsWith("ies")) word = `${word.slice(0, -3)}y`;
		else if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) word = word.slice(0, -1);
		if (!STOP_WORDS.has(word)) words.add(word.slice(0, 6));
	}
	return words;
}
