# Readlist fit

Decides which links fit a readlist the reader described. A caller hands it the reader's Keep and Skip text, a purpose version, up to 20 of the reader's earlier keep or drop calls, the links (an id, the URL and the words the reader saw) and, for an email, its subject and sender. It answers `keep`, `drop` or `unsure` with a one-sentence reason of at most 120 characters for every link, in input order, plus the engine, the model and the token usage of the call.

The package depends only on the domain package, the AI message package and zod. It holds no storage, queue, web or SDK code, takes no logger and writes no log line: the caller records each call, so a missing log line is the caller's to add.

## Engine switch

Two engines, named by the values a Pulumi config key carries:

| Engine value | Model | Role |
|---|---|---|
| `deepseek-flash` | Flash, thinking disabled, 8,192 output tokens | Production |
| `deepseek-v4-pro-thinking` | V4 Pro, thinking enabled, 32,768 output tokens | Rollback, by a config commit |

The engine map picks the AI message adapter for an engine, so a caller passes only the SDK's chat-completion call and the package never imports the SDK. A composition root parses the engine value with the package's engine schema at module load, so an unknown value fails the Lambda's init instead of the first call.

The prompt is a TypeScript string constant, not a Markdown file, because a Lambda bundle copies non-TypeScript files only from its own asset directory. It must keep the lowercase word "json", which DeepSeek's JSON output mode requires.

## Prices

The package's per-link price table is an assumption at DeepSeek peak prices, and nothing reads it to bound spend. The figures assume, per call, 600 cached and 450 missed prompt tokens; per link, 150 input and 40 output tokens; and 22.5 links per email. The staging measurement replaces both figures with measured ones by editing the price table, its test and this section.
