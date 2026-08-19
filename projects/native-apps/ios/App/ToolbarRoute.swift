import Foundation

/// The side effect a tapped collection-toolbar control resolves to, decided
/// purely from the affordance's advertised invocation. Keeping the decision in a
/// pure value (rather than inline in the view) lets the routing be unit-tested
/// without a SwiftUI host.
enum ToolbarRoute: Equatable {
	/// Follow a navigable link by opening its href in the in-app web view — the app
	/// acting as a browser over the contract. Reserved for navigable LINKS, never an
	/// action: an action is a capability the client submits, not a page it browses to.
	case open(SirenLink)
	/// Invoke the action through the generic invoker, honouring its own
	/// method/type/fields/value. A bare-invokable collection action carries everything
	/// the request needs (the server fills each declared field's `value`), so it is
	/// submitted in place rather than opened as a GET web view of its href.
	case invoke(SirenAction)
	/// Present the native add-link instructions sheet. The `add-links-help` link is a
	/// help affordance the client renders as its own sheet (reading the href from the
	/// view model) rather than browsing to the page, so which sheet a control presents
	/// is decided here, not by a name check in the view.
	case presentAddLinksHelp

	/// Routes an affordance: the `add-links-help` link presents the native help sheet;
	/// any other navigable link opens in the web view; any action is invoked through
	/// the generic invoker. An action is never opened as a GET web view of its href —
	/// that would discard its method/type/fields and silently turn a capability into
	/// navigation. The decision maps each affordance to an effect without gating which
	/// controls exist.
	static func route(for affordance: Affordance) -> ToolbarRoute {
		switch affordance.invocation {
		case .link where Affordance.isAddLinksHelp(affordance.token):
			return .presentAddLinksHelp
		case let .link(link):
			return .open(link)
		case let .action(action):
			return .invoke(action)
		}
	}
}
