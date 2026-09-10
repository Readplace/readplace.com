---
name: ios-programming
description: Swift, UIKit and SwiftUI conventions for the iOS app and its share extension. Use when writing or changing a .swift file, when choosing between UIKit and SwiftUI for a screen, when a view test cannot reach the iOS coverage floor, or when a captured snapshot of a view does not show what the simulator shows.
---

# iOS Programming

Language- and framework-specific rules only. Every design rule that is not iOS-specific — testing, comments, coverage, naming, dependency injection — lives in the language-agnostic skills and in [CLAUDE.md](../../../CLAUDE.md), which carries the Swift analog of each one.

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
