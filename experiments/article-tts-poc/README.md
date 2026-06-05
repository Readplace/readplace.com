# Article Text-to-Speech — Proof of Concept + Cost Estimate

A small, self-contained spike that answers two questions:

1. **Can we narrate any saved Readplace article with a natural-sounding voice?** — yes; the pipeline is short and slots cleanly into the existing crawl flow.
2. **What would it cost?** — a one-time fraction of a cent per article. With today's models the *most natural* option is no longer the *most expensive* one.

This lives in `experiments/` (alongside `ios-readplace-poc`) so it stays out of the production `pnpm check` gate. It has **zero runtime dependencies** — it runs on Node's built-in TypeScript support and `fetch`.

---

## TL;DR recommendation

| | Pick | Why |
|---|---|---|
| **Best quality** | **Google Gemini 3.1 Flash TTS** | Tops the June 2026 blind-test leaderboard *and* is mid-priced (~$0.15/article). The old "naturalness = premium price" rule no longer holds. |
| **Best fit for our stack** | **Amazon Polly (Generative)** | Already inside our AWS account — no new vendor, no new secret, IAM-only. Slightly behind on quality, cheapest path to ship. |
| **Best price/quality + least new code** | **OpenAI gpt-4o-mini-tts** | ~$0.10/article, and we already call an OpenAI-compatible API (DeepSeek) for summaries — the adapter is nearly identical. |

Recommended starting point: **ship on Amazon Polly Generative** (zero new infra surface), keep the provider behind the `SynthesizeSpeech` seam, and A/B a premium voice (Gemini / ElevenLabs) on a sample of articles before committing.

---

## What's here

```
src/
  cost.ts                  Provider rate table (June 2026) + pure cost model
  narration.ts             Article HTML → clean narration text (+ duration/cost stats)
  tts.ts                   Provider-agnostic SynthesizeSpeech contract + dry-run impl
  providers/
    openai-tts.ts          gpt-4o-mini-tts adapter  (fetch, zero deps)
    elevenlabs-tts.ts      ElevenLabs adapter       (fetch, zero deps)
  sample-article.ts        Bundled article so the demo runs offline
  demo.ts                  Runnable: narration + cost tables (+ real audio if a key is set)
test/
  cost.test.ts             Cost-model unit tests
  narration.test.ts        Narration-extraction unit tests
```

### Run it

```bash
cd experiments/article-tts-poc

pnpm test         # 11 unit tests, Node's built-in runner — no install needed
pnpm demo         # offline: prints narration stats + the full cost comparison
pnpm typecheck    # tsc --noEmit (uses the repo's TypeScript)

# Generate real audio to ./out/sample.mp3:
OPENAI_API_KEY=sk-...   pnpm demo
# or
ELEVENLABS_API_KEY=...  ELEVENLABS_VOICE_ID=...  pnpm demo
```

Offline `pnpm demo` output (abridged):

```
Article: "Why We Still Read Long Things"
Extracted 316 words / 1762 characters → ~2.0 min of audio

Cost for a TYPICAL article (≈1,100 words) and a 10k-article month:
Provider                         Rank     $/article         $/mo @10k    AWS
────────────────────────────────────────────────────────────────────────────
Google Gemini 3.1 Flash TTS         1       $0.1452         $1,452.00     no
Inworld TTS-1.5 Max                 2       $0.0660           $660.00     no
ElevenLabs Flash v3                 3       $0.6600         $6,600.00     no
OpenAI gpt-4o-mini-tts              4       $0.0990           $990.00     no
Amazon Polly (Generative)           5       $0.1980         $1,980.00    yes
Amazon Polly (Neural)               6       $0.1056         $1,056.00    yes
```

---

## The June 2026 TTS landscape

Naturalness is judged by blind A/B listening tests (the [Artificial Analysis "Speech Arena"](https://artificialanalysis.ai/text-to-speech/leaderboard) ELO ladder). The notable shift this year: **ElevenLabs is no longer the single leader**, and the new leaders are *cheaper* than it.

| Provider | Naturalness (June 2026) | Native pricing | ≈ $/1M chars | AWS-native |
|---|---|---|---|---|
| Google Gemini 3.1 Flash TTS | #1 (Speech Arena ELO ~1,214) | $1 /1M text-in + $20 /1M audio-out tokens | ~$22 | no |
| Inworld TTS-1.5 Max | top tier (ELO ~1,195–1,236) | ~$10 /1M chars (enterprise) | ~$10 | no |
| ElevenLabs Flash v3 | top tier (MOS ~4.3) | 0.5 credit/char; ~$0.06–$0.30 /1K chars by plan | ~$60–$300 | no |
| OpenAI gpt-4o-mini-tts | strong (MOS ~3.9) | ~$0.015/min audio | ~$15 | no |
| Amazon Polly (Generative) | high | $30 /1M chars | $30 | **yes** |
| Amazon Polly (Neural) | good | $16 /1M chars | $16 | **yes** |

> Leaderboards move weekly and prices change (ElevenLabs cut TTS up to ~55% shortly before this was written). Treat every number as a point-in-time reading. The machine-readable version lives in [`src/cost.ts`](./src/cost.ts) — update it there and the demo/tests follow.

---

## Cost estimate

**Assumptions** (all tunable in [`src/cost.ts`](./src/cost.ts)):

- Average article ≈ **1,100 words ≈ 6,600 characters** (~6 chars/word incl. spaces). We can compute this exactly from `article.metadata.wordCount`.
- Narration pace ≈ **150 wpm**, so a typical article ≈ **7–8 minutes** of audio.
- Synthesis is **billed once per article** and the result is cached (keyed by the canonical content hash). Re-listens cost nothing but trivial S3/CloudFront egress (an 8-min MP3 ≈ 4–8 MB).

**Per-article one-time cost**

| Provider | $/typical article |
|---|---|
| Inworld TTS-1.5 Max | **$0.066** |
| OpenAI gpt-4o-mini-tts | **$0.099** |
| Amazon Polly Neural | **$0.106** |
| Google Gemini 3.1 Flash TTS | **$0.145** |
| Amazon Polly Generative | **$0.198** |
| ElevenLabs Flash v3 | **$0.660** |

**At scale — 10,000 newly-saved articles in a month** (one-time, not recurring):

| Provider | $/month @ 10k new articles |
|---|---|
| Inworld TTS-1.5 Max | **$660** |
| OpenAI gpt-4o-mini-tts | **$990** |
| Amazon Polly Neural | **$1,056** |
| Google Gemini 3.1 Flash TTS | **$1,452** |
| Amazon Polly Generative | **$1,980** |
| ElevenLabs Flash v3 | **$6,600** |

**The headline:** narrating *every* article in the best-on-leaderboard voice (Gemini) costs ~**$1,450 per 10k articles, once**. The premium-brand option (ElevenLabs) is ~4.5× that for no quality lead. Cost scales with *new* articles, not with listens, so the steady-state bill tracks save volume, not engagement.

**Levers to cut it further:** generate lazily (only when a reader first presses "Listen", not for every save) — most saved articles are never opened, so on-demand could cut volume by 5–10×; cache aggressively by content hash; and reserve the premium voice for opt-in/paid tiers while defaulting to Polly/OpenAI.

---

## How this maps onto Readplace

Audio generation mirrors the existing **summary** pipeline almost exactly — async, event-driven, S3-backed.

**Trigger.** Subscribe a new `generate-audio` Lambda to `CanonicalContentChangedEvent` (defined in [`src/packages/hutch-infra-components/src/events.ts`](../../src/packages/hutch-infra-components/src/events.ts)) — the same event that already kicks off summary regeneration. Content is canonical and clean at that point.

**Read.** Pull the canonical body from S3 (`content/{url}/content.html`) via the existing `initS3ReadContent()` provider ([`projects/hutch/src/runtime/providers/article-store/s3-read-content.ts`](../../projects/hutch/src/runtime/providers/article-store/s3-read-content.ts)). Run it through `htmlToNarration` (here for the POC; production should reuse `@packages/article-parser`'s readability extraction).

**Synthesize.** Call a `SynthesizeSpeech` adapter (this POC ships OpenAI + ElevenLabs; Polly is a ~30-line `@aws-sdk/client-polly` wrapper). The provider key follows the existing secret pattern — `pulumi.secret(requireEnv("TTS_API_KEY"))`, mirroring `deepseekApiKey` at [`projects/save-link/src/infra/index.ts`](../../projects/save-link/src/infra/index.ts). Polly needs no key at all — just an IAM grant.

**Store.** Write the MP3 to a new (or existing content) bucket at `audio/{encodeURIComponent(url)}/audio.mp3`, served through the existing CloudFront media CDN. Record an `audioStatus` (`pending`/`ready`/`failed`) + duration on the article aggregate, exactly like `summaryStatus`.

**Play.** Add an audio-status slot to the reader UI — mirror `summary-slot` and drop a `<audio controls>` / "▶ Listen" button into the `reader__share-row` of [`projects/hutch/src/runtime/web/pages/reader/reader.template.html`](../../projects/hutch/src/runtime/web/pages/reader/reader.template.html), revealed by the same HTMX polling the reader already does.

```
CanonicalContentChangedEvent
        │
        ▼
 generate-audio Lambda ── reads ──▶ S3 content/{url}/content.html
        │                                   │
        │                          htmlToNarration()
        │                                   ▼
        │                          SynthesizeSpeech (Polly | Gemini | OpenAI | ElevenLabs)
        │                                   │
        └── writes ──▶ S3 audio/{url}/audio.mp3 ──▶ CloudFront ──▶ "▶ Listen" in reader
```

A new `src/packages/article-audio/` package would hold the shared types (`AudioStatus`, the `SynthesizeSpeech` contract) the same way `article-state-types` holds `SummaryStatus`.

---

## Productionising — checklist

- [ ] `src/packages/article-audio/` for `AudioStatus` + `SynthesizeSpeech` types (mirror `article-state-types`).
- [ ] `audioStatus` + `audioDurationSeconds` on the article aggregate and DynamoDB row.
- [ ] `generate-audio` Lambda + DLQ, subscribed to `CanonicalContentChangedEvent` (mirror `generate-summary`).
- [ ] Polly adapter (`@aws-sdk/client-polly`) as the default `SynthesizeSpeech`; keep OpenAI/ElevenLabs adapters behind the same seam.
- [ ] S3 `audio/` prefix + CloudFront behaviour + lifecycle policy.
- [ ] Chunk long articles to the provider's per-request limit and concatenate (Polly Generative caps at ~3,000 chars/request; others vary).
- [ ] Reader UI audio slot + HTMX status polling (mirror `summary-slot`).
- [ ] **Decide generation timing**: eager on save vs. lazy on first "Listen". Lazy is materially cheaper and the recommended default.
- [ ] Add the chosen provider's real per-request limits and SSML handling to `cost.ts` / the adapter.
- [ ] 100% coverage + knip + biome when it moves into a real workspace package (this POC is exempt by living in `experiments/`).

---

## Caveats

- Pricing and rankings are a **June 2026 snapshot** — re-check before budgeting.
- `htmlToNarration` is a dependency-free approximation for the demo. Production must reuse `@packages/article-parser` so narration matches what readers see (and to handle figures, code blocks, footnotes sensibly).
- Token-priced models (Gemini, OpenAI) are normalised to $/1M-char estimates; the per-request bill depends on the actual audio produced.
- This is **not** an Anthropic/Claude capability — Claude has no TTS model, so every option here is third-party. (Claude remains the right tool for the *summary* side of the pipeline.)

---

## Sources

- Artificial Analysis — Text-to-Speech Leaderboard / Speech Arena: <https://artificialanalysis.ai/text-to-speech/leaderboard>
- AssemblyAI — Top text-to-speech APIs in 2026: <https://www.assemblyai.com/blog/top-text-to-speech-apis>
- Speechmatics — Best TTS APIs in 2026: <https://www.speechmatics.com/company/articles-and-news/best-tts-apis-in-2025-top-12-text-to-speech-services-for-developers>
- ElevenLabs — API pricing: <https://elevenlabs.io/pricing/api>
- OpenAI — API pricing: <https://openai.com/api/pricing/>
- Amazon Polly — pricing: <https://aws.amazon.com/polly/pricing/>
- Google Gemini 3.1 Flash TTS — pricing (OpenRouter): <https://openrouter.ai/google/gemini-3.1-flash-tts-preview>
- Inworld — pricing: <https://inworld.ai/pricing>
- MarkTechPost — Best TTS models in 2026, a benchmark comparison: <https://www.marktechpost.com/2026/05/30/best-text-to-speech-tts-models-in-2026-a-benchmark-based-comparison/>
