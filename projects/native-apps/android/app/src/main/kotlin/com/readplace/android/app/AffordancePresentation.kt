package com.readplace.android.app

import com.readplace.android.core.Affordance
import com.readplace.android.core.Article

/**
 * The glyph a control renders, as one of the client's own design tokens rather
 * than a drawable, so the mapping below stays a plain decision the Compose layer
 * resolves to an icon.
 */
enum class AffordanceIcon {
	PLUS,
	KEY,
	CHECKMARK_CIRCLE,
	TRASH,
	MAGNIFYING_GLASS,
	PERSON_CIRCLE,
	ELLIPSIS_CIRCLE,
}

/**
 * The colour role a control renders in, resolved to a real colour by the Compose
 * layer. [NEUTRAL] names no colour of its own: the control inherits the
 * surrounding style.
 */
enum class AffordanceTint {
	NEUTRAL,
	SUCCESS,
	DESTRUCTIVE,
}

/**
 * The client-side presentation for an advertised affordance: icon, tint, and the
 * role hints the UI needs. Presentation is 100% a client concern — the server
 * sends no style or class — so this maps the affordance's wire token (an action
 * `name` or a link `rel`) to the client's own design tokens. An unknown token
 * falls back to a neutral default, so an affordance the client has never seen
 * still renders (with a generic look) rather than vanishing.
 */
data class AffordancePresentation(
	val icon: AffordanceIcon,
	/** The control's tint, or [AffordanceTint.NEUTRAL] to inherit the surrounding
	 * style. */
	val tint: AffordanceTint,
	/** Whether the control mutates server state with no undo — the View uses this
	 * to mark a swipe action destructive and to confirm before invoking. */
	val isDestructive: Boolean,
	/** Whether invoking the control unconditionally removes the item it acts on from
	 * the current (unread-only) list, knowable from the wire token alone. Only
	 * `delete` qualifies: it always removes the item regardless of any field value.
	 * `update-status` is a server toggle (it may set the status to `read` OR
	 * `unread`), so whether it removes the row depends on the action's `status`
	 * field `value`, not the token — that transition-aware decision lives in
	 * `Affordance.removesItemFromUnreadList`, not here. */
	val removesItem: Boolean,
	/** Whether the wire token alone allows presenting this affordance as a
	 * collection toolbar control. `false` for two kinds excluded structurally (not
	 * name-gated as a known capability): a structural navigation link
	 * (`self`/`root`/`prev`/`next`/`item`), which the client follows itself for
	 * pagination/identity/item resolution, never as a user control; and an action
	 * that needs a captured page (`save-content`), which the app can only reach
	 * through the system share sheet, not the toolbar. An unknown token is
	 * toolbar-presentable so a newly-advertised affordance still renders. A third,
	 * field-dependent exclusion (a field-requiring action with no server value)
	 * cannot be decided from the token alone and lives in
	 * `Affordance.isToolbarControl`. */
	val isToolbarControl: Boolean,
	/** Whether the client recognises this wire token as one of its own mapped
	 * affordances (an explicit branch below) rather than the neutral default an
	 * unknown token falls to. `Affordance.isToolbarControl` surfaces an
	 * *unrecognised* affordance as a control only when the server also gave it a
	 * human `title`: a title-less token the client doesn't recognise is a machine
	 * capability the client invokes bespoke (like `create-session`), advertised on
	 * the collection but never a toolbar button — so a machine action the server
	 * adds later can't phantom-render on an already-shipped build. */
	val isRecognizedToken: Boolean,
	/** Whether a toolbar control renders the affordance's server title beside its
	 * glyph rather than icon-only. True for `account`, because store review requires
	 * the account-deletion path to be findable and a bare glyph names nothing; every
	 * other control keeps the toolbar narrow. */
	val showsTitle: Boolean,
) {
	companion object {
		/** Derives the presentation for a wire token. The mapping is the client's own;
		 * the token is never used as a style string verbatim. A token with no mapping
		 * gets the neutral default so an unknown affordance still renders. */
		fun of(token: String): AffordancePresentation = when (token) {
			"save-content" -> AffordancePresentation(
				icon = AffordanceIcon.PLUS,
				tint = AffordanceTint.NEUTRAL,
				isDestructive = false,
				removesItem = false,
				isToolbarControl = false,
				isRecognizedToken = true,
				showsTitle = false,
			)
			// Not a user control: the client invokes this bespoke to mint the reader
			// session cookie (like a capture-only save), so it never renders in the
			// toolbar even though it is advertised on the collection.
			"create-session" -> AffordancePresentation(
				icon = AffordanceIcon.KEY,
				tint = AffordanceTint.NEUTRAL,
				isDestructive = false,
				removesItem = false,
				isToolbarControl = false,
				isRecognizedToken = true,
				showsTitle = false,
			)
			"update-status" -> AffordancePresentation(
				icon = AffordanceIcon.CHECKMARK_CIRCLE,
				tint = AffordanceTint.SUCCESS,
				isDestructive = false,
				removesItem = false,
				isToolbarControl = true,
				isRecognizedToken = true,
				showsTitle = false,
			)
			"delete" -> AffordancePresentation(
				icon = AffordanceIcon.TRASH,
				tint = AffordanceTint.DESTRUCTIVE,
				isDestructive = true,
				removesItem = true,
				isToolbarControl = true,
				isRecognizedToken = true,
				showsTitle = false,
			)
			"search" -> AffordancePresentation(
				icon = AffordanceIcon.MAGNIFYING_GLASS,
				tint = AffordanceTint.NEUTRAL,
				isDestructive = false,
				removesItem = false,
				isToolbarControl = true,
				isRecognizedToken = true,
				showsTitle = false,
			)
			"account" -> AffordancePresentation(
				icon = AffordanceIcon.PERSON_CIRCLE,
				tint = AffordanceTint.NEUTRAL,
				isDestructive = false,
				removesItem = false,
				isToolbarControl = true,
				isRecognizedToken = true,
				showsTitle = true,
			)
			"add-links-help" -> AffordancePresentation(
				icon = AffordanceIcon.PLUS,
				tint = AffordanceTint.NEUTRAL,
				isDestructive = false,
				removesItem = false,
				isToolbarControl = true,
				isRecognizedToken = true,
				showsTitle = false,
			)
			in Affordance.structuralRels -> AffordancePresentation(
				icon = AffordanceIcon.ELLIPSIS_CIRCLE,
				tint = AffordanceTint.NEUTRAL,
				isDestructive = false,
				removesItem = false,
				isToolbarControl = false,
				isRecognizedToken = true,
				showsTitle = false,
			)
			else -> AffordancePresentation(
				icon = AffordanceIcon.ELLIPSIS_CIRCLE,
				tint = AffordanceTint.NEUTRAL,
				isDestructive = false,
				removesItem = false,
				isToolbarControl = true,
				isRecognizedToken = false,
				showsTitle = false,
			)
		}
	}
}

val Affordance.presentation: AffordancePresentation get() = AffordancePresentation.of(token)

/**
 * The structural navigation link rels the client follows for its own navigation —
 * pagination (`prev`/`next`), identity (`self`/`root`), and item resolution
 * (`item`) — never rendered as user controls. Single source so the presentation
 * mapping and any other structural classification can't drift on which rels are
 * plumbing rather than affordances.
 */
val Affordance.Companion.structuralRels: Set<String> get() = STRUCTURAL_RELS

private val STRUCTURAL_RELS: Set<String> = setOf("self", "root", "prev", "next", "item")

/**
 * Whether a link `rel` is one the client renders through its own in-app
 * presentation rather than browsing to the href in the web view. The
 * `add-links-help` link opens the native add-link instructions sheet — a help
 * affordance the client presents itself — so the toolbar routes it to that sheet
 * instead of opening its href as a page. Single source for the routing decision.
 */
fun Affordance.Companion.isAddLinksHelp(rel: String): Boolean = rel == "add-links-help"

/**
 * Whether the client can invoke this affordance from a bare toolbar control.
 * Per the contract, a field-requiring action whose fields carry no
 * server-provided `value` is not invokable by a bare control: the value must come
 * from the server's field. A link, an action with no fields, and an action whose
 * declared fields all carry a server `value` are bare-invokable; a field-requiring
 * action with no server value (e.g. `search`, which the app has no query UI for,
 * or `save-article`, whose URL the toolbar does not prompt for — it is a
 * share-sheet capability, not a toolbar control) is not, so the client never
 * surfaces a control it cannot actually invoke. An unknown field-less action stays
 * invokable so a newly-advertised affordance still renders.
 */
val Affordance.isInvokableByBareControl: Boolean
	get() = action?.fields?.all { it.value != null } ?: true

/**
 * Whether this affordance is a link carrying any structural navigation rel
 * (`self`/`root`/`prev`/`next`/`item`) — client plumbing the client follows for
 * its own pagination/identity/item resolution, never a user control. Tests every
 * rel, not just the presentation token, so a multi-rel link like
 * `["alternate", "next"]` can't slip through as a tappable control while the
 * client also follows it for paging.
 */
val Affordance.isStructuralLink: Boolean
	get() = link?.rel?.any { it in Affordance.structuralRels } ?: false

/**
 * Whether the row surfaces this link as a discrete control: a semantic link that
 * is neither structural plumbing nor the `read` rel (already the row's primary tap
 * target). Keeps a future item link (e.g. `share`) rendering as a control instead
 * of being discarded, without double-rendering `read`.
 */
val Affordance.isSemanticControlLink: Boolean
	get() = link?.rel?.none { it in Affordance.structuralRels || it == "read" } ?: false

/**
 * Whether the toolbar should surface this affordance as a control: it must be
 * presentable in the toolbar (a structural navigation link or a capture-only save
 * is excluded), not carry any structural rel, be actually invokable from a bare
 * control (a field-requiring action with no server value is excluded), and either
 * be a token the client recognises or carry a server `title`. The last rule keeps
 * a machine capability the client doesn't recognise and the server didn't title
 * (e.g. a future `create-session`-like action minting a session) from
 * phantom-rendering as a mystery button on an already-shipped build — the server
 * signals "render this" by giving the affordance a human `title`.
 */
val Affordance.isToolbarControl: Boolean
	get() {
		if (isStructuralLink) return false
		if (!presentation.isToolbarControl || !isInvokableByBareControl) return false
		return presentation.isRecognizedToken || hasServerTitle
	}

/**
 * Whether the server gave this affordance a human `title` — its signal that the
 * affordance is a user control to render, not a machine capability the client
 * invokes bespoke. An empty title counts as none.
 */
private val Affordance.hasServerTitle: Boolean
	get() = when (val source = invocation) {
		is Affordance.Invocation.OfAction -> !source.action.title.isNullOrEmpty()
		is Affordance.Invocation.OfLink -> !source.link.title.isNullOrEmpty()
	}

/**
 * Whether invoking this affordance removes the item it acts on from the
 * unread-only reading list — the row the post-action adoption drops when the
 * server's returned collection can't confirm it (a deep-scrolled merge keeps rows
 * the fresh head doesn't cover, and a non-collection response carries no re-list
 * direction at all). `delete` always removes (known from the token).
 * `update-status` is a server toggle, so it removes the row only when its `status`
 * field's server-supplied `value` moves the item out of the unread-only list
 * (`read`); a toggle back to `unread` leaves the row in place.
 */
val Affordance.removesItemFromUnreadList: Boolean
	get() {
		if (presentation.removesItem) return true
		val status = action?.fields?.firstOrNull { it.name == "status" }?.value
		return status == "read"
	}

/**
 * The advertised item affordances a row surfaces as swipe and accessibility
 * controls: every action a bare control can actually invoke, plus every semantic
 * link that is neither structural plumbing nor the `read` tap target — so a future
 * item link (e.g. `share`) renders instead of being discarded. Like the toolbar,
 * the row drops a field-requiring action with no server value so a future such
 * item action is never rendered as a swipe that errors on tap. The selection lives
 * here, beside the symmetric toolbar rule (`Affordance.isToolbarControl`) and the
 * shared predicates it reuses (`isInvokableByBareControl`,
 * `isSemanticControlLink`), so the row's choice of controls is unit-testable
 * without standing up a view.
 */
val Article.rowControls: List<Affordance>
	get() = affordances.filter { it.isInvokableByBareControl } +
		links.mapNotNull { Affordance.of(it) }.filter { it.isSemanticControlLink }
