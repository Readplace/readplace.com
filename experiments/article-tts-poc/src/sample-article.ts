/**
 * A bundled sample article so the demo runs with no network and no saved data.
 * Original prose written for this POC. The <script> and entities are intentional —
 * they exercise the narration extractor.
 */

export const sampleArticleTitle = "Why We Still Read Long Things";

export const sampleArticleHtml = `
<article>
  <h1>Why We Still Read Long Things</h1>
  <p>Every few years someone announces that the long read is finished &mdash; that
  attention has thinned to the width of a feed, and nobody will sit with a thousand
  words again. And every few years the long read quietly outlives the obituary.</p>

  <script>console.log("analytics that must never be spoken aloud");</script>

  <h2>The case against</h2>
  <p>The pessimist&rsquo;s argument is easy to make. Screens are built for skimming.
  A headline competes with a notification, which competes with a message, which
  competes with the next headline. Reading something carefully is, in that economy,
  almost a rebellion.</p>

  <h2>The case for</h2>
  <p>But the appetite never actually went away. People still save articles they mean
  to finish, still forward essays to a friend with the note &ldquo;this is worth your
  time,&rdquo; still feel the small satisfaction of closing a tab because it&rsquo;s
  <em>done</em> rather than abandoned. What changed is not the appetite but the
  <strong>moment</strong>: the right time to read a saved piece is rarely the moment
  you found it.</p>

  <p>That gap &mdash; between finding and finishing &mdash; is where a reading queue
  earns its place. It is also, increasingly, where listening fits. A narrated article
  turns a commute, a walk, or a pile of dishes into reading time you didn&rsquo;t know
  you had. The words are the same; only the channel is new.</p>

  <h2>What good narration asks for</h2>
  <p>The bar is higher than it used to be. A flat, robotic voice breaks the spell in
  the first sentence; a natural one disappears, and you are simply listening to the
  piece. Getting there means clean text in &mdash; no navigation, no captions, no
  cookie banners &mdash; and a voice good enough that you forget it is synthetic.</p>

  <p>Both halves are now within reach. The text is already extracted and stored. The
  voices, finally, are good. The only real question left is which one to use, and what
  it costs to let a reader press play.</p>
</article>
`;
