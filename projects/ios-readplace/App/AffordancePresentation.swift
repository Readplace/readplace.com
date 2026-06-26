import SwiftUI

/// The client-side presentation for an advertised affordance: icon, tint, and the
/// role hints the UI needs. Presentation is 100% a client concern — the server
/// sends no style or class — so this maps the affordance's wire token (an action
/// `name` or a link `rel`) to the client's own design tokens. An unknown token
/// falls back to a neutral default, so an affordance the client has never seen
/// still renders (with a generic look) rather than vanishing.
struct AffordancePresentation {
	/// The SF Symbol the control draws.
	let systemImage: String
	/// The control's tint, or nil to inherit the surrounding style.
	let tint: Color?
	/// Whether the control mutates server state with no undo — the View uses this
	/// to mark a swipe action destructive and to confirm before invoking.
	let isDestructive: Bool
	/// Whether invoking the control unconditionally removes the item it acts on from
	/// the current (unread-only) list, knowable from the wire token alone. Only
	/// `delete` qualifies: it always removes the item regardless of any field value.
	/// `update-status` is a server toggle (it may set the status to `read` OR
	/// `unread`), so whether it removes the row depends on the action's `status`
	/// field `value`, not the token — that transition-aware decision lives in
	/// `Affordance.removesItemFromUnreadList`, not here. Per 'State Lives in the
	/// Network', an action that does not remove the item leaves the list untouched
	/// and lets the next load reconcile it.
	let removesItem: Bool
	/// Whether the wire token alone allows presenting this affordance as a
	/// collection toolbar control. `false` for two kinds excluded structurally (not
	/// name-gated as a known capability): a structural navigation link
	/// (`self`/`root`/`prev`/`next`/`item`), which the client follows itself for
	/// pagination/identity/item resolution, never as a user control; and an action
	/// that needs a captured page (`save-html`/`save-content`), which iOS can only reach through
	/// the Share Sheet, not the toolbar. An unknown token is toolbar-presentable so a
	/// newly-advertised affordance still renders. A third, field-dependent exclusion
	/// (a field-requiring action with no server value and no bespoke handler) cannot
	/// be decided from the token alone and lives in `Affordance.isToolbarControl`.
	let isToolbarControl: Bool

	/// Derives the presentation for a wire token. The mapping is the client's own;
	/// the token is never used as a style string verbatim. A token with no mapping
	/// gets the neutral default so an unknown affordance still renders.
	init(token: String) {
		switch token {
		case "save-article", "save":
			systemImage = "plus"
			tint = nil
			isDestructive = false
			removesItem = false
			isToolbarControl = true
		case "save-html", "save-content":
			systemImage = "plus"
			tint = nil
			isDestructive = false
			removesItem = false
			isToolbarControl = false
		case "update-status":
			systemImage = "checkmark.circle"
			tint = .brandSuccess
			isDestructive = false
			removesItem = false
			isToolbarControl = true
		case "delete":
			systemImage = "trash"
			tint = .red
			isDestructive = true
			removesItem = true
			isToolbarControl = true
		case "search":
			systemImage = "magnifyingglass"
			tint = nil
			isDestructive = false
			removesItem = false
			isToolbarControl = true
		case "add-links-help":
			systemImage = "questionmark.circle"
			tint = nil
			isDestructive = false
			removesItem = false
			isToolbarControl = true
		case let rel where Affordance.structuralRels.contains(rel):
			systemImage = "ellipsis.circle"
			tint = nil
			isDestructive = false
			removesItem = false
			isToolbarControl = false
		default:
			systemImage = "ellipsis.circle"
			tint = nil
			isDestructive = false
			removesItem = false
			isToolbarControl = true
		}
	}
}

extension Affordance {
	/// This affordance's client-side presentation, derived from its wire token.
	var presentation: AffordancePresentation { AffordancePresentation(token: token) }

	/// The structural navigation link rels the client follows for its own
	/// navigation — pagination (`prev`/`next`), identity (`self`/`root`), and item
	/// resolution (`item`) — never rendered as user controls. Single source so the
	/// presentation switch and any other structural classification can't drift on
	/// which rels are plumbing rather than affordances.
	static let structuralRels: Set<String> = ["self", "root", "prev", "next", "item"]

	/// Action names the client invokes through a bespoke handler that supplies a
	/// field value the server did not (`save-article` reads a URL the user types in
	/// the native dialog). Such an action is invokable from a bare toolbar control
	/// even though its field carries no server `value`; every other field-requiring
	/// action without a server value is not. This is the one place the client
	/// declares which inputs it can produce itself, not a presentation name-gate.
	private static let bespokeFieldHandlers: Set<String> = ["save-article"]

	/// Whether an action `name` is one the client invokes through a bespoke handler
	/// that supplies a field value the server did not. Single source for both the
	/// bare-control invokability check below and the toolbar's routing decision, so
	/// the two can't disagree on which actions get bespoke handling.
	static func isBespokeFieldHandler(_ name: String) -> Bool {
		bespokeFieldHandlers.contains(name)
	}

	/// Whether the client can invoke this affordance from a bare toolbar control.
	/// Per the contract, a field-requiring action whose fields carry no
	/// server-provided `value` is not invokable by a bare control: the value must
	/// come from the server's field or from a bespoke client handler. A link, an
	/// action with no fields, and an action whose declared fields all carry a server
	/// `value` are bare-invokable; a field-requiring action with no server value and
	/// no bespoke handler (e.g. `search`, which iOS has no query UI for) is not, so
	/// the client never surfaces a control it cannot actually invoke. An unknown
	/// field-less action stays invokable so a newly-advertised affordance still
	/// renders.
	var isInvokableByBareControl: Bool {
		guard case let .action(action) = invocation else { return true }
		if Self.isBespokeFieldHandler(action.name) { return true }
		let fields = action.fields ?? []
		guard !fields.isEmpty else { return true }
		return fields.allSatisfy { $0.value != nil }
	}

	/// Whether the toolbar should surface this affordance as a control: it must be
	/// both presentable in the toolbar (a structural navigation link or a
	/// capture-only save is excluded by its presentation) and actually invokable
	/// from a bare control (a field-requiring action with no server value and no
	/// bespoke handler is excluded).
	var isToolbarControl: Bool {
		presentation.isToolbarControl && isInvokableByBareControl
	}

	/// Whether invoking this affordance removes the item it acts on from the
	/// unread-only reading list, so the View can scope its optimistic row removal to
	/// transitions that actually leave the view. `delete` always removes (known from
	/// the token). `update-status` is a server toggle, so it removes the row only
	/// when its `status` field's server-supplied `value` moves the item out of the
	/// unread-only list (`read`); a toggle back to `unread` leaves the row in place.
	/// Any other action does not remove the row — per 'State Lives in the Network'
	/// the list is left for the next load to reconcile rather than synthesised
	/// client-side.
	var removesItemFromUnreadList: Bool {
		if presentation.removesItem { return true }
		guard case let .action(action) = invocation else { return false }
		let status = (action.fields ?? []).first { $0.name == "status" }?.value
		return status == "read"
	}
}
