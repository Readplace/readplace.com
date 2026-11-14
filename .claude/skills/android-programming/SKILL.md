---
name: android-programming
description: Kotlin, Jetpack Compose and Android framework conventions for the Android app and its share target. Use when writing or changing a .kt file, when deciding where a screen's logic lives versus its Compose or WebView glue, when a file fails the Android coverage gate, when adding audio or media playback, when a WebView or player renders blank, dark or with a flashing control in the app or a recording, or when preparing a Play release — writing "What's new" text or promoting an internal-testing build to production.
---

# Android Programming

Language- and framework-specific rules only. Every design rule that is not Android-specific — testing, comments, coverage, naming, dependency injection — lives in the language-agnostic skills and in [CLAUDE.md](../../../CLAUDE.md). The table at the end gives the Kotlin form of the CLAUDE.md rules that name a TypeScript or Swift construct. Running the app on an emulator is the [android-emulator skill](../android-emulator/SKILL.md).

## Intro music must coexist with other audio

Whenever the app plays background music, other apps' audio MUST keep playing. Today the intro's players never request audio focus, so the two streams mix. If focus handling is ever turned on, use music content attributes and never a full `AUDIOFOCUS_GAIN`, because that stops the reader's podcast or playlist.

The player is built once per Activity lifetime, in a recreation-surviving owner that releases it when cleared. Mute is a volume change, not a pause, so the loop stays in step with the video. Playback stops when the Activity leaves the foreground, because without focus handling nothing else pauses it for a call.

Verify on a windowed emulator boot (the headless boot has no audio) or a physical device, with another app's audio already playing: cold launch, return to the foreground, signed in, muted. Report a physical-device check separately.

## The Activity is the composition root, Compose draws, and the decisions are plain values

Two Activities exist, the main app and the share target. Each builds its dependencies and calls `setContent`, and nothing else. Every screen is Compose. A platform View (a WebView, a media player view) enters only through `AndroidView`, and a View subclass exists only when the framework requires one, such as a WebView that has to take part in nested scrolling inside a sheet.

The split that tests depend on is between **decision** and **glue**, not between View and Compose:

| Layer | What it holds | How it is tested |
|---|---|---|
| Decision | A rule written as a pure function or a sealed type, such as "is this navigation in-app or external", a load phase, or a row's text and affordances | Plain JVM unit test |
| Screen state | A plain class that exposes `StateFlow` and is given an injected `CoroutineScope`. It is not an androidx `ViewModel` | JVM test under `runTest` with a test dispatcher |
| Glue | A `WebViewClient`, a Compose layout, an Activity, a Keystore or SharedPreferences adapter | Excluded from coverage, with a reason |

When a glue file starts to hold an `if` that could be wrong, move the condition into a decision sibling and leave the glue calling it. An androidx `ViewModel` is used only as an owner that survives recreation, never as the place where logic lives.

## Shape code so the coverage gate passes

The gate counts **lines**, not branches. A line that never runs fails it, but a partly-taken `?:` or `when` does not. So the phantom-branch workarounds the TypeScript and Swift code needs have no place here. Read the coverage-check script and its baseline in the app's scripts directory for the rules: a file in neither list must be at 100%, and an empty report fails. Adding an `excluded` entry needs human approval ([CLAUDE.md](../../../CLAUDE.md#never-add-excludes-or-ignore-patterns-to-coverage-lint-knip-etc-without-approval)).

| Avoid in a decision or state file | Because | Instead |
|---|---|---|
| An `android.*` type (Uri, Log, Context, Bundle) | It needs Robolectric or an emulator to run | `java.net.URI`, `java.time`, `java.io.File`, or an interface seam |
| `Dispatchers.IO` or `Instant.now()` written inline | A test cannot control time or threading | An injected `CoroutineDispatcher` and an injected `() -> Instant` or `Clock` |
| Logging from the core | That pulls `android.util.Log` into a JVM test | An injected failure callback, logged by the composition root |
| Robolectric for a decision | It is slow and hides that the decision depends on the framework | Plain JUnit. Keep Robolectric for tests whose subject is a real framework object: Intent or ClipData reading, Keystore providers, nested-scroll dispatch |

JaCoCo skips classes that Robolectric loads through its own class loader unless the test task includes no-location classes. The app's Gradle build sets this up, so don't remove it when you touch the test configuration.

## A WebView or player that renders wrong

There are no pixel snapshot tests. What you see is the emulator's framebuffer (`make screenshot`) or a recording. These failures look like rendering bugs but are construction-order bugs:

| Symptom | Cause | Fix |
|---|---|---|
| An off-screen capture WebView renders blank | A WebView with no parent loads at 0×0 | Parent it into the Activity's content root at real bounds before loading |
| A WebView in a bottom sheet renders dark in light mode | It takes its theme from the dialog window's platform theme | Build it from a context themed from the Compose dark-mode state |
| A media player view flashes its controls over the first frames | The controller was enabled when the player was attached | Turn the controller off before attaching the player |

## Every production promotion describes what changed since the last one

CI uploads every shipping change to the internal testing track and sends no release notes. Production is a dispatch of the "Promote Android build to Play production" workflow; dispatching it in `promote` mode is the human's act, and an agent dispatches `check` only. Which release notes a promotion carries, and when to promote in Play Console instead, is the Promotion entry of the [Android README's release section](../../../projects/native-apps/android/README.md#releasing). Play caps the "What's new" text at 500 characters per language. Write it from git history, not from memory. The baseline is the version code currently on the production track: successful runs titled `Promote Android v<N> …` in `gh run list --workflow "Promote Android build to Play production"` name the codes promoted from CI, and Play Console remains the source when the list is empty or a promotion was made there. Diff from its `android-readplace@v<N>` tag (`git tag --list 'android-readplace@v*' --sort=-v:refname`).

Read the same two scopes as an iOS release ([ios-programming](../ios-programming/SKILL.md#every-release-describes-everything-that-changed-since-the-one-apple-last-saw)): the app project's own commits, and the server surfaces the app shows or obeys. Sort each commit into feature, behaviour change, fix or internal. Leave internal ones out. Write the rest in the [brand voice](../../../BRAND_GUIDELINES.md).

## CLAUDE.md rules in Kotlin

| CLAUDE.md rule | Kotlin form |
|---|---|
| No `as` assertions | No `as` or `!!` on values from outside the app. Use `as?` with an early return, or `?: return null`. An `as` contained in a platform-API wrapper (a Keystore entry type) is the isolated-wrapper exception |
| `assert` for invariants | `check(...)` for state and `require(...)` for arguments |
| Branded IDs | `@JvmInline value class` |
| Zod at the boundary | Decode wire JSON by hand from `JsonElement`, dropping one bad entity rather than failing the page. Use `@Serializable` only for records the app writes and reads back itself |
| Errors as types | A sealed exception hierarchy per boundary, and a sealed interface (with `data object` for payload-free cases) per decision |
| Named parameters when types repeat | Named arguments at the call site |
| Required dependencies, no default fakes | Constructor injection from the composition root. No `= null` or in-memory default on a production parameter |
