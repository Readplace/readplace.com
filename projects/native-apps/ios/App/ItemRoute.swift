import Foundation

/// The side effect a tapped per-item control resolves to, decided purely from the
/// affordance's advertised invocation and its presentation. The row's swipe /
/// accessibility twin of `ToolbarRoute`: keeping the decision in a pure value —
/// rather than inline in the view — lets the routing (open a link, confirm a
/// destructive action, or invoke) be unit-tested without a SwiftUI host, so a
/// link-only item control is opened rather than silently dropped and a destructive
/// control never invokes without a confirmation.
enum ItemRoute: Equatable {
	/// Follow a navigable link by opening its href in the in-app web view.
	case open(SirenLink)
	/// A destructive action (no undo) awaits an explicit confirmation before it invokes.
	case confirmDestructive(SirenAction)
	/// Invoke a non-destructive action immediately through the generic invoker.
	case invoke(SirenAction)

	/// Routes an item affordance: a navigable link opens; an action whose
	/// client-side presentation marks it destructive awaits confirmation; any other
	/// action invokes immediately. Whether an action is destructive is the single
	/// presentation mapping's call, never a per-name check in the view.
	static func route(for affordance: Affordance) -> ItemRoute {
		switch affordance.invocation {
		case let .link(link):
			return .open(link)
		case let .action(action):
			return affordance.presentation.isDestructive ? .confirmDestructive(action) : .invoke(action)
		}
	}
}
