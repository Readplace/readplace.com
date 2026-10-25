---
name: ios-programming
description: Swift, UIKit and SwiftUI conventions for the iOS app and its share extension. Use when writing or changing a .swift file, when choosing between UIKit and SwiftUI for a screen, when a view test cannot reach the iOS coverage floor, when a captured snapshot of a view does not show what the simulator shows, or when preparing a TestFlight build or an App Store version — writing its "What to Test" note, its App Store release notes or its App Review notes, or dispatching the `whats_new`, `release` or `resubmit` fastlane lanes.
---

# iOS Programming

Language- and framework-specific rules only. Every design rule that is not iOS-specific — testing, comments, coverage, naming, dependency injection — lives in the language-agnostic skills and in [CLAUDE.md](../../../CLAUDE.md), which carries the Swift analog of each one.

## Background music must coexist with other audio

Whenever the app provides background music, it MUST let other apps' audio continue playing instead of taking exclusive control of the audio session. Configure a mixing category or `.mixWithOthers` before any operation that activates the session, including `AVAudioPlayer.prepareToPlay()`. Constructing a launch model or a player must not activate audio when playback is not needed. Muting the player does not prevent session activation or interruptions.

Verify cold launches and foreground returns with external audio already playing, including signed-in and muted states. Simulator callback tests alone do not establish that another app's audio remains uninterrupted; report physical-device verification separately.

## UIKit for the skeleton, SwiftUI for the leaves

Build a screen's structure in UIKit — the container, its scroll view, its constraints, its primary action — and its repeated leaf content in SwiftUI, hosted one leaf at a time through a hosting controller.

Most of SwiftUI is a wrapper over UIKit, and it is worth understanding what runs underneath. That is not a reason to scrap SwiftUI: use it where it shines — a small piece of declarative content whose appearance is a pure function of its state — and UIKit where it does not.

The split is a rule rather than a preference because of what it does to tests. A UIKit skeleton hands a test the real controls, so the test reads their frames and asserts numbers with prose failure messages. A screen that is SwiftUI all the way down offers a test nothing but a layer tree, and the test ends up hunting for a layer of a known size — a match that silently finds the wrong layer the moment a size changes.

## Shape UIKit code so the coverage floor is reachable

A new source file with no recorded floor must be fully covered ([CLAUDE.md → Code Coverage](../../../CLAUDE.md#code-coverage)). Three UIKit habits create a path no test can run; each has a plain alternative.

| Avoid | Because | Instead |
|---|---|---|
| Subclassing a view or control | The compiler demands the coder initialiser, whose body is an unreachable fatal error | A main-actor class that *owns* a view rather than being one |
| A closure action that captures a weak self | Unwrapping it adds an else branch that never runs | Target/action to a method on the owner |
| An `if` on screen width or content height | Both arms need a test, and one needs a contrived screen | A constraint below required priority, which breaks when it cannot hold |

The last row is the load-bearing one. A preferred width held below required priority, set against required margin inequalities, resolves to the widest size that fits — with no branch to cover. Scrolling engages the same way: a low-priority hug tying a scroll view to its content breaks once the container reaches its height cap.

## Capturing a view for a visual test

A capture that walks the layer tree draws whatever sits in each layer's backing store, which is not what SwiftUI has most recently been told to show. A leaf whose state changed since the last display cycle captures at its **previous** appearance. Draw the hierarchy through the render server instead, with the view in a visible window, and give the run loop a turn first so the pending update commits.

The danger is in the recording direction, not the verifying one. A stale capture verifies against itself on every later run, so the gate stays green while the committed picture shows something the app never renders — a silent false pass, which is the one failure a visual gate must not have.

## Every release describes everything that changed since the one Apple last saw

App Review Guideline 2.3.1(a) requires every new feature to be described with specificity in the Notes for Review, and 2.5.19 rejects features hidden from the reviewer. Notes written from memory miss features, including the ones the server shipped without a new binary. Write them from the git history.

| Note | Baseline to diff from |
|---|---|
| TestFlight "What to Test" | The previous build's `ios-readplace@v*` tag (`git tag --list 'ios-readplace@v*' --sort=-v:refname`) |
| App Store release notes and App Review notes | The last build submitted for App Review, which is the build the last "prepare build N for store review" commit on the review notes names. The `whats_new` lane's `status:true` lists the App Store versions to confirm it. Most TestFlight builds never reach review, so the previous tag is the wrong baseline here |

Read two scopes of history from the baseline to the build's tag:

- **The app**: commits under the iOS project's directory (`pnpm nx show project ios` gives its root).
- **Server surfaces the app shows or obeys.** These ship without a new binary, so a reviewer sees them only if the notes name them. They are the Siren responses (the `save-article`, `save-content`, `update-status` actions and the `account` link), the reader page and its `readplaceReader` message bridge to the app, the pages rendered for the app (the app config names the query items it appends, `platform` and `shell`; the server branches on the same names), the OAuth sign-in and consent pages behind `/oauth/authorize`, and the shared nav and banners. Grep the main app for those wire values to find the files, then `git log` them.

Sort every commit into user-visible feature, behaviour change, fix, or internal. Internal commits are left out. Every feature and behaviour change goes into:

- **The release notes**: the fastlane metadata file both the `whats_new` and `release` lanes read, written for readers in the [brand voice](../../../BRAND_GUIDELINES.md).
- **The review notes' "CHANGES IN <version>" block**: say what each change is and how a reviewer can exercise it. Name anything that runs without a tap, such as an automatic capture, and anything the server added since the last reviewed build.

Then re-read the review notes' standing claims (which servers the app talks to, where purchases happen, tracking, account deletion) against the diff, and fix any the diff has made false.

App Store Connect caps the review notes at 4,000 bytes, and the lanes upload the file whole. Check the file with `wc --bytes` and cut older wording until it fits. The notes went over the cap once already.

The lanes read these files from the branch they run on. Commit and push the notes before dispatching `whats_new`, `release` or `resubmit`.
