## Voice

The [brand guidelines](../../../../brand-guidelines/voice-and-copy.md#voice--copy) own the product voice — impersonal, quiet and specific, no hype. Post prose carries no first person, singular or plural: the byline names who wrote the post, and the prose names what acted ("Readplace writes the summary when the save finishes"). See [No invented actors](#no-invented-actors) for what replaces "I".

### Name the actor

**Prefer the active voice. When a sentence hides who acted, name them.** In almost every case the actor is Readplace, the code, a site, the reader, or one named person, and naming it is shorter and more honest.

> A summary is generated when the save finishes.

> Readplace writes the summary when the save finishes.

The product already holds itself to this: the TL;DR prompt described in the post at `/blog/how-ai-tldr-actually-works` demands "active voice, short sentences, plain connectors, specific facts, and no jargon" of the model. The blog should not write worse than the summariser it ships.

**This is not a ban.** A passive is correct, and should be left alone, when:

- The actor is genuinely unknown or irrelevant — *"The page was re-saved through Aspose."*
- The receiver is the topic and naming the actor would bury it — *"Your article is saved."* is the shape the [writing principles](../../../../brand-guidelines/voice-and-copy.md#writing-principles) endorse; *"Summaries are capped at 750 characters"* is about the cap.
- Naming an actor would over-claim, attributing a decision to a component that does not make it.
- It is quoted UI copy, an error string, or a term of art (*source-available*).
- The active version reads longer or shifts emphasis off the point.

And these are not passives at all, so don't "fix" them: adjectival participles (*saved articles*, *the stored copy*), present perfect (*has shipped*), and idiomatic get-passives (*the redirected hop is refused too*).

Ten real fixes beat forty that flatten the prose. A sweep that de-passivises everything reads like a machine went through it, which is the one thing this blog is arguing against.

### No invented actors

Taking "I" out must not put a crowd in its place. A post never states or implies how many people work on the product, in either direction. Banned as actors: *we, our, us, the team, engineers, developers, staff, support, any department, "someone at", "internally", "it was decided"*, and passives that smuggle a group back in (*"after internal review"*). Use the first actor that is true:

- The product, or a named part of it, for what it does at runtime — *The booking page holds the seat for 10 minutes.*
- The change itself, for an engineering decision or a wrong turn — *The first patch retried the payment. It double-charged 3 bookings and came out the same day.*
- The evidence, for a measurement — *A 30-day pull of check-in events had 41 of 600 marked duplicate.*
- The page, for editorial stance or a bias disclosure — *This comparison is published by the airline it ranks first.*
- "You", for a how-to step, within the second-person caps in [Writing Rules](writing-rules.md#writing-rules) and [Structural Variety](structure.md#structural-variety).
- One named person with their role, once, for a fact from that person's own life — *Ana Reyes, the founder, kept paper tickets in a shoebox for 10 years.*

If none of these is true, restructure the sentence or cut it. A replacement adds no fact the original did not carry.

### Claims about the product itself

State mechanisms that exist today, not promises about the future. A post does not say the product will last, will not shut down, or will still be here next year; does not grant rights the licence does not (self-hosting, reuse) or claim data never leaves its region when a third party processes it; and does not assert a funding outcome ("pays its own bills", "the money keeps it alive") that the reader cannot check. Name what the code does now and let the reader weigh it.

### Choosing a voice

Five voices are available. Before drafting, state in one sentence what the post is about, name the voice you think fits and why, and ask the person to confirm or pick another. If the material sits between two, name both and let them decide.

Then draw the content out of them **one question at a time**, so they make the content decisions rather than reviewing decisions you already made. A batch of questions gets a batch of shallow answers.

| The post… | Voice |
|---|---|
| makes a single claim and proves it with one example | [Principle](#voice-1-principle) |
| describes a type of person, behaviour, or cultural pattern | [Observer](#voice-2-observer) |
| reconstructs a real incident and extracts a lesson | [War Story](#voice-3-war-story) |
| tells a personal story where tension and pacing matter | [Narrative](#voice-4-narrative) |
| proposes a framework, scoring system, or structured model | [Framework](#voice-5-framework) |

### Shared rules across voices

**Perspective.** Impersonal. Write a practitioner's account with the product, the code, the change, or the evidence as the subject, not "I" or "we". Let the ideas carry the weight. Assume the reader is a peer, not a student.

**Opening variety.** Structural Variety governs every opening. No voice gets to default to one fixed opening shape. The example openings under each voice show the archetype's *subject matter*, not a first word to copy: read them as "this is the kind of thing this voice notices".

**Sentences.** One idea per sentence. Follow a long sentence with a short one, and let the short one land the point. Average 10–20 words, with one sentence in five running past 25. Avoid subordinate clauses where a new sentence works. Never more than three sentences in a row without a paragraph break, Narrative Voice excepted.

**Paragraphs.** One idea per paragraph. If a paragraph runs long it holds two ideas, so split it. Blank line between every paragraph, no exceptions.

**Direction.** Move from the specific to the general. Ground claims in concrete detail before extracting the principle, and build through concrete examples rather than abstract argument, one example per idea.

**Editing standard.** Every sentence must earn its place. If removing it loses nothing, remove it. A short post that lands cleanly beats a long post that wanders.

#### The pull-quote technique

A pull-quote is a single sentence in bold or blockquote that compresses the paragraph's claim. It gives skimmers the skeleton while the surrounding text gives close readers the flesh.

Use one when a paragraph holds a claim worth compressing, and never more than three. Of the published posts that carry any, most carry one or two. Do not add one to a post that has no such claim: a device that fires in every post becomes the sameness [Structural Variety](structure.md#structural-variety) exists to prevent.

**Questions.** Genuine questions once per 300 words at most, and only when answered in the next sentence. Rhetorical questions are banned in every voice.

**Tone.** No superlatives (best, revolutionary, game-changing). No exclamation marks. No emoji in body text. No filler transitions. Modest but not self-deprecating: state what you observed, not what you felt about it.

**Words that leak into technical writing most often**, on top of the general ban list: "journey", "deep dive", "game-changer", "takeaway", "unpack", "landscape", "realm", "delve".

**What to avoid in every voice:**

- Do not summarize what you just said at the end of a section.
- Do not tell the reader what they are about to learn.
- Do not repeat the same point in different words to fill space.
- Do not use passive voice where active is possible.
- Do not withhold a concrete word for effect. If you can name the thing, name it now. A vague placeholder followed by the real noun a few sentences later reads as manufactured suspense. "It rests on something more durable" stalls in front of a word the post already has: relational algebra. Use the word.

### The five voices

#### Voice 1: Principle

**When to use:** the post makes a single claim and proves it with one example. Titles like "X Doesn't Matter" or "X Is a Smell". **This is the tightest mode. Every sentence earns its place or gets cut.**

*Opening.* The lookback governs your first line. The belief-then-invert move is one entry this voice can use, not a required opener: state a short declarative observation that sounds true, then immediately complicate or invert it. When you use it, do not start with "I" or with a question.

*Structure.* Open with the assertion. Prove it with one concrete example — one, not three. Move from the specific to the general. End when the point is made.

*Paragraphs.* Two to four sentences maximum.

*Section breaks.* A thematic sentence standing alone on its own line, crystallizing the point of what follows. For example: "Attention is what you can't get back once it's gone."

*Closing.* A two-line contrast: the first line restates the conventional goal, the second replaces it with the better one. "Writing code faster is a reasonable goal. Writing it without interruption is a better one."

This is not the staccato "Not X. Y." punchline banned in [Patterns That Read as Machine-Written](writing-rules.md#patterns-that-read-as-machine-written). A valid contrast uses two complete thoughts with specific content, and it should be the kind of line someone could pull out and share on its own. A fake contrast uses fragments that negate and assert without substance ("Not hype. Reality."). If both lines cannot stand alone as full sentences with real meaning, cut it. **Do not use this closing if any of the last 8 posts closed on a two-line contrast** — when the point lands cleanly in the final paragraph, let the post end there.

*Length.* 800 to 1,200 words. Shorter is fine if the post is done.

#### Voice 2: Observer

**When to use:** the post describes a type of person, behaviour pattern, or cultural phenomenon. **This is the most human mode. You are naming something people recognize but haven't articulated.**

*Opening.* Whatever entry the material wants, checked against the lookback. Second-person observation is one way in, not the default, and it is capped. You can place the reader inside a recognizable behaviour without opening on the word "You": name the behaviour, the type, or the moment first, then bring the reader in.

*Perspective shift.* This voice uses "you" to describe archetypes — "you" here means "a person like this", not the reader directly. For an interpretation or a first-hand observation, state it plainly and name its source rather than reaching for "I".

*Structure.* Open with the observable behaviour. Build the profile through specific details: what these people do, say, and avoid. Reference a named concept (Dunning-Kruger, Goodhart's Law) only if it sharpens the observation, never as the foundation. Close with empathy or a reframe — you are describing something you have seen and probably been, so do not mock it.

*Paragraphs.* Two to five sentences. This voice needs slightly more room.

*Tone.* Reflective and measured, with more space between claims than the Principle voice. Qualify with concrete conditions, not modals: "This pattern shows up more in teams that ship weekly" is fine, "This could work for smaller teams" is not.

*Closing.* No required format. End when the observation is complete. If a two-line contrast fits, use it, subject to the same shareable-line test as Voice 1. If the final paragraph already closes the loop, stop there.

*Length.* 800 to 1,400 words.

#### Voice 3: War Story

**When to use:** the post reconstructs a real incident, bug, outage, or debugging session. **This is the most readable mode. The reader discovers the point alongside the account.**

*Opening.* Start with the incident. Name the technology, the context, and what went wrong, and drop the reader into the middle of the problem rather than working up to it. Run the lookback first: if recent posts opened on "A user saved …" or the same shape, find another way in. The incident starts on the system, the symptom, the number, or the broken output. The subject of a wrong turn is the attempt, never a person or a group.

*Structure.* Chronological. Describe the debugging path step by step, including the wrong turns. Name the technologies involved — specifics make war stories credible. Extract the lesson at the end, not the beginning.

*Paragraphs.* Short, two to three sentences.

*Tone.* Procedural and grounded. No drama, the facts carry the tension. Be candid about the wrong turns: the hero of the story is the debugging process, not any person.

*Closing.* State what the incident showed in one or two sentences. Do not generalize beyond the incident unless the generalization is earned, and do not announce it with "The lesson …" if a recent incident post used that frame. The ending can land on the fixed behaviour or the result and let the lesson sit unstated.

*Length.* 600 to 1,000 words. War stories that run long lose their punch.

#### Voice 4: Narrative

**When to use:** the post tells one person's story where tension, pacing, and sensory detail matter. Rare — origin stories, life events, formative experiences, told in the third person and named once with the person's role, and only with the owner's sign-off before drafting. **This is the widest-range mode. Sentence and paragraph rules loosen to serve the story.**

*Opening.* The cold sensory scene is the corpus's most over-used opening, so this is the one voice whose defining move collides with axis a. Resolve it this way: the scene opening *is* the voice, so you may use it, but only when no recent post opened on a scene, and you must still vary the scene's first word and shape against the last 8. When the lookback permits a scene, drop the reader into it with sensory detail — what the person saw, heard, or physically felt. Do not set up context first. Start in the middle.

*Structure.* Chronological — the structure follows time, not argument. Build suspense through pacing, not by withholding information. Atmospheric detail is encouraged here when it builds tension.

*Paragraphs.* Variable. Some are one sentence, some run to five or six when the scene demands it. The three-sentence break rule does not apply. Blank lines between paragraphs still do.

*Sentences.* Shorter during high tension, longer while setting a scene. Let the rhythm mirror the pacing of the event. The bans on multi-verb-phrase sentences and stacked clauses relax during scene-setting; action and dialogue follow the standard rules.

*Tone.* Vulnerable and self-aware, admitting fear, bad decisions, and uncertainty. Still no self-deprecation for its own sake.

*Closing.* End on the aftermath or the quiet moment after the tension breaks. Do not moralize.

*Length.* 600 to 1,500 words. Length follows the story.

#### Voice 5: Framework

**When to use:** the post proposes a framework, scoring system, mental model, or structured evaluation method. **This is the most formal mode. Authority comes from the structure of the argument, not from personal anecdote.**

*Opening.* Stating the problem the framework solves is this voice's natural entry. Use it when the lookback allows, and be specific about who has the problem and when. If a recent post already opened by stating a problem, find another way in.

*Structure.* Open with the problem. Introduce the framework by name, and say plainly if you coined it. Define each component with one concrete example. Show how the components interact. Acknowledge what the framework does not cover.

*Paragraphs.* Three to five sentences — this voice tolerates longer paragraphs because the content is structural. Use bolded component names as inline anchors, not as section headers, so the post reads as continuous argument rather than a reference doc.

*Tone.* Authoritative but not impersonal. Reference the experience the framework came from briefly, then let it stand on its own. Honest caveats matter more here than anywhere else: a framework that claims to cover everything is not credible. Qualify with concrete conditions and boundaries, not modals.

*Closing.* State the single question the framework helps answer. Do not oversell it. If you use a contrast closing, it takes the same shareable-line test as Voice 1.

*Length.* 1,000 to 1,500 words. Frameworks need room, but not padding.

### Patterns worth using

**The reframe** — state what people assume, then show what is actually true.

> Most developers use AI to write code faster. The bottleneck was not the typing.

Use sparingly, one per post at most, because the pattern loses force through repetition. A reframe uses two complete, specific sentences. It is not a staccato "Not X. Y." punchline. It also needs three conditions or it is hollow:

- The reader must already hold the assumption you state. If you assigned the reaction to them, cut it. "That claim sounds like nostalgia" assigns a reaction most readers never had.
- The two halves must be real opposites. Nostalgia and durability are not opposites, so a "but" between them joins nothing.
- Do not pre-label how the reader should receive your claim. State the claim, show the proof, let them judge.

**The concrete cost** — make an abstract problem tangible with time or effort.

> That's 20 minutes gone. The fix was simple and the problem was that you had to be the one to do it.

**The ellipsis pause** — three dots where a single period would end the thought too cleanly.

> That's 20 minutes gone... The fix was simple and the problem was that you had to be the one to do it.

**The honest caveat** — acknowledge a limitation before the reader raises it, using "TBH" rather than the word "honest". A colon works here, and so does "=/" when something is genuinely odd or confusing.

> There's something worth clarifying: the workflows don't get it right every time.
> I know this works, but TBH... It only works sometimes =/

**TBH** is real house style; the **ellipsis pause** and **=/** are rare. Grep the posts directory for a marker when calibrating a draft. Treat these as available, not expected. A marker force-inserted into every draft becomes its own tell.

**The "not every X" boundary** — closes a section that establishes a limit.

> Not every bug is worth fixing.

Once per post at most. Twice makes it a tic.

### Reference sentences

These show the register to match across all modes.

> Writing code faster is a reasonable goal. Writing it without interruption is a better one.

> Not every feature is worth coding.

> The cognitive difference between handling an interruption and reviewing a result is large. One requires you to stop. The other doesn't.

> Over-engineering is subjective, and the damage of its subjectiveness increases as the requirements fail to present the full picture.

> The internet is open and free, but it forgets.
