import SwiftUI

/// The client-side presentation for an advertised affordance: icon, tint, and the
/// role hints the UI needs. Presentation is 100% a client concern — the server
/// sends no style or class — so this maps the affordance's wire token (an action
/// `name` or a link `rel`) to the client's own design tokens. An unknown token
/// falls back to a neutral default, so an affordance the client has never seen
/// still renders (with a generic look) rather than vanishing.
struct AffordancePresentation {
	let systemImage: String
	/// The control's tint, or nil to inherit the surrounding style.
	let tint: Color?
	/// Whether the control mutates server state with no undo — the View uses this
	/// to mark a swipe action destructive and to confirm before invoking.
	let isDestructive: Bool
	/// Whether the wire token alone allows presenting this affordance as a
	/// collection toolbar control. `false` for two kinds excluded structurally (not
	/// name-gated as a known capability): a structural navigation link
	/// (`self`/`root`/`prev`/`next`/`item`), which the client follows itself for
	/// pagination/identity/item resolution, never as a user control; and an action
	/// that needs a captured page (`save-content`), which iOS can only reach through
	/// the Share Sheet, not the toolbar. An unknown token is toolbar-presentable so a
	/// newly-advertised affordance still renders. A third, field-dependent exclusion
	/// (a field-requiring action with no server value) cannot be decided from the
	/// token alone and lives in `Affordance.isToolbarControl`.
	let isToolbarControl: Bool
	/// Whether the client recognises this wire token as one of its own mapped
	/// affordances (an explicit case below) rather than the neutral default an
	/// unknown token falls to. `Affordance.isUserControl` surfaces an
	/// *unrecognised* affordance as a control only when the server also gave it a
	/// human `title`: a title-less token the client doesn't recognise is a machine
	/// capability the client invokes bespoke (like `create-session`), advertised on
	/// the collection but never a toolbar button — so a machine action the server
	/// adds later can't phantom-render on an already-shipped build.
	let isRecognizedToken: Bool
	/// Whether a toolbar control renders the affordance's server title beside its
	/// glyph rather than icon-only. True for `account`, because App Store review
	/// requires the account-deletion path to be findable and a bare glyph names
	/// nothing; every other control keeps the toolbar narrow.
	let showsTitle: Bool

	/// Derives the presentation for a wire token. The mapping is the client's own;
	/// the token is never used as a style string verbatim. A token with no mapping
	/// gets the neutral default so an unknown affordance still renders.
	init(token: String) {
		switch token {
		case "save-content":
			systemImage = "plus"
			tint = nil
			isDestructive = false
			isToolbarControl = false
			isRecognizedToken = true
			showsTitle = false
		case "create-session":
			// Not a user control: the client invokes this bespoke to mint the reader
			// session cookie (like a capture-only save), so it never renders in the
			// toolbar even though it is advertised on the collection.
			systemImage = "key"
			tint = nil
			isDestructive = false
			isToolbarControl = false
			isRecognizedToken = true
			showsTitle = false
		case "update-status":
			systemImage = "checkmark.circle"
			tint = .brandSuccess
			isDestructive = false
			isToolbarControl = true
			isRecognizedToken = true
			showsTitle = false
		case "delete":
			systemImage = "trash"
			tint = .red
			isDestructive = true
			isToolbarControl = true
			isRecognizedToken = true
			showsTitle = false
		case "search":
			systemImage = "magnifyingglass"
			tint = nil
			isDestructive = false
			isToolbarControl = true
			isRecognizedToken = true
			showsTitle = false
		case "account":
			systemImage = "person.crop.circle"
			tint = nil
			isDestructive = false
			isToolbarControl = true
			isRecognizedToken = true
			showsTitle = true
		case "add-links-help":
			systemImage = "plus"
			tint = nil
			isDestructive = false
			isToolbarControl = true
			isRecognizedToken = true
			showsTitle = false
		case let rel where Affordance.structuralRels.contains(rel):
			systemImage = "ellipsis.circle"
			tint = nil
			isDestructive = false
			isToolbarControl = false
			isRecognizedToken = true
			showsTitle = false
		default:
			systemImage = "ellipsis.circle"
			tint = nil
			isDestructive = false
			isToolbarControl = true
			isRecognizedToken = false
			showsTitle = false
		}
	}
}

extension Affordance {
	var presentation: AffordancePresentation { AffordancePresentation(token: token) }

	/// The structural navigation link rels the client follows for its own
	/// navigation — pagination (`prev`/`next`), identity (`self`/`root`), and item
	/// resolution (`item`) — never rendered as user controls. Single source so the
	/// presentation switch and any other structural classification can't drift on
	/// which rels are plumbing rather than affordances.
	static let structuralRels: Set<String> = ["self", "root", "prev", "next", "item"]

	/// Whether a link `rel` is one the client renders through its own in-app
	/// presentation rather than browsing to the href in the web view. The
	/// `add-links-help` link opens the native add-link instructions sheet — a help
	/// affordance the client presents itself — so the toolbar routes it to that
	/// sheet instead of opening its href as a page. Single source for the routing
	/// decision.
	static func isAddLinksHelp(_ rel: String) -> Bool {
		rel == "add-links-help"
	}

	/// Whether the client can invoke this affordance from a bare toolbar control.
	/// Per the contract, a field-requiring action whose fields carry no
	/// server-provided `value` is not invokable by a bare control: the value must
	/// come from the server's field. A link, an action with no fields, and an action
	/// whose declared fields all carry a server `value` are bare-invokable; a
	/// field-requiring action with no server value (e.g. `search`, which iOS has no
	/// query UI for, or `save-article`, whose URL the toolbar does not prompt for —
	/// it is a Share-Sheet capability, not a toolbar control) is not, so the client
	/// never surfaces a control it cannot actually invoke. An unknown field-less
	/// action stays invokable so a newly-advertised affordance still renders.
	var isInvokableByBareControl: Bool {
		guard case let .action(action) = invocation else { return true }
		let fields = action.fields ?? []
		guard !fields.isEmpty else { return true }
		return fields.allSatisfy { $0.value != nil }
	}

	/// Whether this affordance is a link carrying any structural navigation rel
	/// (`self`/`root`/`prev`/`next`/`item`) — client plumbing the client follows for
	/// its own pagination/identity/item resolution, never a user control. Tests every
	/// rel, not just the presentation token, so a multi-rel link like
	/// `["alternate", "next"]` can't slip through as a tappable control while the
	/// client also follows it for paging.
	var isStructuralLink: Bool {
		guard case let .link(link) = invocation else { return false }
		return link.rel.contains { Affordance.structuralRels.contains($0) }
	}

	/// Whether the row surfaces this link as a discrete control: a semantic link that
	/// is neither structural plumbing nor the `read` rel (already the row's primary
	/// tap target). Keeps a future item link (e.g. `share`) rendering as a control
	/// instead of being discarded, without double-rendering `read`.
	var isSemanticControlLink: Bool {
		guard case let .link(link) = invocation else { return false }
		return !link.rel.contains { Affordance.structuralRels.contains($0) || $0 == "read" }
	}

	/// Whether the toolbar should surface this affordance as a control: it must be
	/// presentable in the toolbar (a structural navigation link or a capture-only
	/// save is excluded), not carry any structural rel, be actually invokable from a
	/// bare control (a field-requiring action with no server value is excluded), and
	/// be a user control.
	var isToolbarControl: Bool {
		guard !isStructuralLink else { return false }
		guard presentation.isToolbarControl, isInvokableByBareControl else { return false }
		return isUserControl
	}

	/// Whether this affordance is a user control: either a token the client
	/// recognises or one the server gave a `title`. The rule keeps a machine
	/// capability the client doesn't recognise and the server didn't title (e.g. a
	/// future `create-session`-like action minting a session) from phantom-rendering
	/// as a mystery control on an already-shipped build — the server signals "render
	/// this" by giving the affordance a human `title`.
	var isUserControl: Bool {
		presentation.isRecognizedToken || hasServerTitle
	}

	/// Whether the server gave this affordance a human `title` — its signal that the
	/// affordance is a user control to render, not a machine capability the client
	/// invokes bespoke. An empty title counts as none.
	private var hasServerTitle: Bool {
		switch invocation {
		case let .action(action): return action.title?.isEmpty == false
		case let .link(link): return link.title?.isEmpty == false
		}
	}
}

extension Article {
	/// The advertised item affordances a row surfaces as swipe and accessibility
	/// controls. Like the toolbar, the row drops a field-requiring action with no
	/// server value so a future such item action is never rendered as a swipe that
	/// errors on tap. The selection lives here, beside the symmetric toolbar rule
	/// (`Affordance.isToolbarControl`) and the shared predicates it reuses
	/// (`isInvokableByBareControl`, `isSemanticControlLink`, `isUserControl`), so the
	/// row's choice of controls is unit-testable without standing up a view.
	var rowControls: [Affordance] {
		affordances.filter { $0.isInvokableByBareControl && $0.isUserControl }
			+ links.compactMap(Affordance.init(link:)).filter { $0.isSemanticControlLink && $0.isUserControl }
	}
}
