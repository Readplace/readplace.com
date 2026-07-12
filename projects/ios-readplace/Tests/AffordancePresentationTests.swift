import XCTest
@testable import Readplace

/// Presentation is 100% a client concern: each known wire token maps to the
/// client's own icon/tint/role, and an unknown token falls back to a neutral
/// default so an affordance the client has never seen still renders rather than
/// vanishing. The token is never used as a style string verbatim.
final class AffordancePresentationTests: XCTestCase {
	func testAddLinksHelpMapsToANeutralAddControlInTheToolbar() {
		// The reading list's + control is a client-injected add-links-help affordance:
		// a neutral add (+) glyph that opens the Share help sheet.
		let presentation = AffordancePresentation(token: "add-links-help")
		XCTAssertEqual(presentation.systemImage, "plus")
		XCTAssertNil(presentation.tint)
		XCTAssertFalse(presentation.isDestructive)
		XCTAssertFalse(presentation.removesItem)
		XCTAssertTrue(presentation.isToolbarControl)
	}

	func testMachineOnlyActionsAreNotToolbarControls() {
		// iOS can't capture a page from the toolbar, so save-html/save-content are
		// reached only through the Share Sheet; create-session is invoked bespoke to
		// mint the reader session. None render in the toolbar.
		for token in ["save-html", "save-content", "create-session"] {
			let presentation = AffordancePresentation(token: token)
			XCTAssertFalse(presentation.isToolbarControl, "\(token) must not present as a toolbar control")
			XCTAssertFalse(presentation.removesItem)
			XCTAssertFalse(presentation.isDestructive)
		}
	}

	func testUpdateStatusMapsToAReadControlWhoseRemovalIsTransitionDependent() {
		let presentation = AffordancePresentation(token: "update-status")
		XCTAssertEqual(presentation.systemImage, "checkmark.circle")
		XCTAssertEqual(presentation.tint, .brandSuccess)
		XCTAssertFalse(presentation.isDestructive)
		XCTAssertFalse(
			presentation.removesItem,
			"update-status is a server toggle, so whether it removes the row depends on the field value, not the token"
		)
		XCTAssertTrue(presentation.isToolbarControl)
	}

	func testDeleteMapsToADestructiveTrashControlThatRemovesTheItem() {
		let presentation = AffordancePresentation(token: "delete")
		XCTAssertEqual(presentation.systemImage, "trash")
		XCTAssertEqual(presentation.tint, .red)
		XCTAssertTrue(presentation.isDestructive, "delete is irreversible, so the View confirms before invoking")
		XCTAssertTrue(presentation.removesItem)
	}

	func testSearchMapsToANeutralMagnifierControl() {
		let presentation = AffordancePresentation(token: "search")
		XCTAssertEqual(presentation.systemImage, "magnifyingglass")
		XCTAssertNil(presentation.tint)
		XCTAssertFalse(presentation.isDestructive)
		XCTAssertFalse(presentation.removesItem)
		XCTAssertTrue(presentation.isToolbarControl)
	}

	func testAccountMapsToANeutralPersonControlInTheToolbar() {
		// The account link opens the server's /account page in the web sheet; a
		// person glyph, not the generic unknown-token ellipsis, tells the user
		// where their account (and its deletion, per Guideline 5.1.1(v)) lives.
		let presentation = AffordancePresentation(token: "account")
		XCTAssertEqual(presentation.systemImage, "person.crop.circle")
		XCTAssertNil(presentation.tint)
		XCTAssertFalse(presentation.isDestructive)
		XCTAssertFalse(presentation.removesItem)
		XCTAssertTrue(presentation.isToolbarControl)
	}

	func testStructuralLinkRelsAreNeverToolbarControls() {
		// The client follows self/root/prev/next/item itself for pagination, identity,
		// and item resolution; they are never rendered as user controls. `item` in
		// particular: an `item` collection link resolves a member, not a tappable
		// affordance, so it must be excluded structurally like the rest.
		for rel in Affordance.structuralRels.sorted() {
			XCTAssertFalse(
				AffordancePresentation(token: rel).isToolbarControl,
				"\(rel) is a structural navigation link, not a user control"
			)
		}
		XCTAssertTrue(
			Affordance.structuralRels.contains("item"),
			"item is a structural rel (member resolution), so it must not render as a control"
		)
	}

	func testUnknownTokenFallsBackToANeutralDefaultThatStillRenders() {
		let presentation = AffordancePresentation(token: "some-future-action")
		XCTAssertEqual(presentation.systemImage, "ellipsis.circle", "an unknown token gets the generic glyph")
		XCTAssertNil(presentation.tint)
		XCTAssertFalse(presentation.isDestructive)
		XCTAssertFalse(presentation.removesItem)
		XCTAssertTrue(
			presentation.isToolbarControl,
			"a newly-advertised affordance still renders in the toolbar rather than vanishing"
		)
	}

	// MARK: - Transition-aware removal

	private func action(
		name: String,
		href: String? = "/queue/a1/status",
		fields: [SirenField]? = nil
	) -> SirenAction {
		SirenAction(name: name, href: href, method: "POST", title: nil, type: nil, fields: fields)
	}

	func testUpdateStatusRemovesTheRowWhenItsStatusValueMovesTheItemToRead() throws {
		// The server toggle on an unread item targets "read", which leaves the
		// unread-only list, so the row is dropped optimistically.
		let toRead = action(name: "update-status", fields: [SirenField(name: "status", type: "text", value: "read")])
		let affordance = try XCTUnwrap(Affordance(action: toRead))
		XCTAssertTrue(affordance.removesItemFromUnreadList, "a transition to read leaves the unread-only list")
	}

	func testUpdateStatusKeepsTheRowWhenItsStatusValueTogglesBackToUnread() throws {
		// The same action on an already-read item targets "unread"; the row stays in
		// the unread-only list, so nothing is removed — the next load reconciles it.
		let toUnread = action(name: "update-status", fields: [SirenField(name: "status", type: "text", value: "unread")])
		let affordance = try XCTUnwrap(Affordance(action: toUnread))
		XCTAssertFalse(affordance.removesItemFromUnreadList, "a transition to unread does not leave the unread-only list")
	}

	func testDeleteAlwaysRemovesTheRowRegardlessOfFields() throws {
		let delete = action(name: "delete", href: "/queue/a1/delete")
		let affordance = try XCTUnwrap(Affordance(action: delete))
		XCTAssertTrue(affordance.removesItemFromUnreadList, "delete removes the item unconditionally")
	}

	func testAnUnrelatedActionDoesNotRemoveTheRow() throws {
		let other = action(name: "view-original", href: "/queue/a1/original")
		let affordance = try XCTUnwrap(Affordance(action: other))
		XCTAssertFalse(affordance.removesItemFromUnreadList, "an action with no read transition leaves the list untouched")
	}

	func testANavigableLinkNeverRemovesARow() throws {
		let link = try XCTUnwrap(Affordance(link: SirenLink(rel: ["save"], href: "/save", title: nil)))
		XCTAssertFalse(link.removesItemFromUnreadList, "a navigable link acts on no row, so it removes nothing")
	}

	// MARK: - Bare-control invokability

	func testAFieldRequiringActionWithNoServerValueIsNotABareToolbarControl() throws {
		// `search` declares fields the server did not pre-fill and iOS has no query
		// UI, so it is not invokable from a bare control and must not be surfaced.
		let search = action(
			name: "search", href: "/queue",
			fields: [SirenField(name: "status", type: "text", value: nil), SirenField(name: "url", type: "url", value: nil)]
		)
		let affordance = try XCTUnwrap(Affordance(action: search))
		XCTAssertFalse(affordance.isInvokableByBareControl, "a field-requiring action with no server value is not bare-invokable")
		XCTAssertFalse(affordance.isToolbarControl, "so it is not surfaced as a toolbar control")
	}

	func testSaveArticleIsNotABareToolbarControlBecauseItsURLFieldHasNoServerValue() throws {
		// save-article declares a url field with no server value, and iOS does not
		// prompt for it from the toolbar (saving a URL is a Share-Sheet capability),
		// so it is not invokable from a bare control and must not be surfaced.
		let save = action(name: "save-article", href: "/queue", fields: [SirenField(name: "url", type: "url", value: nil)])
		let affordance = try XCTUnwrap(Affordance(action: save))
		XCTAssertFalse(affordance.isInvokableByBareControl, "a field-requiring action with no server value is not bare-invokable")
		XCTAssertFalse(affordance.isToolbarControl, "so it is not surfaced as a toolbar control")
	}

	func testAnActionWhoseFieldsAllCarryAServerValueIsBareInvokable() throws {
		let toRead = action(name: "update-status", fields: [SirenField(name: "status", type: "text", value: "read")])
		let affordance = try XCTUnwrap(Affordance(action: toRead))
		XCTAssertTrue(affordance.isInvokableByBareControl, "the server pre-filled the only field, so a bare control can post it")
		XCTAssertTrue(affordance.isToolbarControl)
	}

	func testAFieldLessActionAndALinkAreBareInvokable() throws {
		let fieldLess = action(name: "some-future-action", href: "/queue/go")
		let link = try XCTUnwrap(Affordance(link: SirenLink(rel: ["save"], href: "/save", title: nil)))
		XCTAssertTrue(try XCTUnwrap(Affordance(action: fieldLess)).isInvokableByBareControl)
		XCTAssertTrue(link.isInvokableByBareControl, "a navigable link carries no fields, so a bare control can open it")
	}

	// MARK: - Machine-capability gate (title-less unknown ⇒ not a toolbar control)

	func testAnUnrecognizedTitlelessActionIsAMachineCapabilityNotAToolbarControl() throws {
		// A future field-less action the client doesn't recognise and the server didn't
		// title — exactly how `create-session` is advertised today — is a machine
		// capability the client invokes bespoke, so it must never surface as a mystery
		// toolbar button on a shipped build.
		let machine = SirenAction(name: "mint-token", href: "/mint", method: "POST", title: nil, type: nil, fields: nil)
		let affordance = try XCTUnwrap(Affordance(action: machine))
		XCTAssertTrue(affordance.isInvokableByBareControl, "it is field-less, so the bare-control check alone would admit it")
		XCTAssertFalse(
			affordance.isToolbarControl,
			"an unrecognised, title-less action is a machine capability and must not render as a toolbar control"
		)
	}

	func testAnUnrecognizedButTitledActionStillRendersAsAToolbarControl() throws {
		// The server signals "this is a user control" by giving the affordance a
		// `title`; a titled unknown action still renders (with the generic look), so a
		// genuinely new user affordance is never dropped.
		let titled = SirenAction(name: "purge-all", href: "/queue/purge", method: "POST", title: "Purge", type: nil, fields: nil)
		let affordance = try XCTUnwrap(Affordance(action: titled))
		XCTAssertTrue(affordance.isToolbarControl, "a titled unknown action is a user control the toolbar surfaces")
	}

	func testAnUnrecognizedTitlelessLinkIsNotAToolbarControl() throws {
		// The same machine-capability rule applies to a link the client doesn't
		// recognise: without a server title it is not surfaced as a control.
		let link = try XCTUnwrap(Affordance(link: SirenLink(rel: ["share"], href: "/share", title: nil)))
		XCTAssertFalse(link.isToolbarControl, "an unrecognised, title-less link is not surfaced as a toolbar control")
	}

	func testAnUnrecognizedTitledLinkRendersAsAToolbarControl() throws {
		let link = try XCTUnwrap(Affordance(link: SirenLink(rel: ["share"], href: "/share", title: "Share")))
		XCTAssertTrue(link.isToolbarControl, "a titled unknown link is surfaced as a toolbar control")
	}

	// MARK: - Structural-rel safety across every rel, not just the first

	func testALinkIsExcludedWhenAnyOfItsRelsIsStructuralNotJustTheFirst() throws {
		// A multi-rel link whose first rel is presentational but which also carries a
		// structural rel (`["alternate", "next"]`) must not render as a control while
		// the client is also following it for pagination — every rel is checked, not
		// just the presentation token.
		let multiRel = try XCTUnwrap(Affordance(link: SirenLink(rel: ["alternate", "next"], href: "/queue?page=2", title: "More")))
		XCTAssertTrue(multiRel.isStructuralLink, "a structural rel anywhere in the list makes the link structural")
		XCTAssertFalse(multiRel.isToolbarControl, "so it is never surfaced as a user control, even with a title")
	}

	func testALinkWithNoStructuralRelStaysACandidateControl() throws {
		let semantic = try XCTUnwrap(Affordance(link: SirenLink(rel: ["alternate", "share"], href: "/share", title: "Share")))
		XCTAssertFalse(semantic.isStructuralLink, "no rel is structural, so the link stays a candidate control")
		XCTAssertTrue(semantic.isToolbarControl, "a titled, non-structural link surfaces as a control")
	}

	// MARK: - Label humanization

	func testLabelHumanizesTheTokenWhenTheServerSentNoTitle() throws {
		let untitled = SirenAction(name: "mark-read", href: "/x", method: "POST", title: nil, type: nil, fields: nil)
		let affordance = try XCTUnwrap(Affordance(action: untitled))
		XCTAssertEqual(affordance.label, "Mark Read", "a title-less action renders a humanized token, not the raw slug")
	}

	func testLabelHumanizesAnUnderscoredOrDoubleDelimitedToken() {
		XCTAssertEqual(Affordance.humanize("archive_now"), "Archive Now")
		XCTAssertEqual(Affordance.humanize("save--link-"), "Save Link", "empty segments are dropped")
	}

	func testLabelPrefersTheServersTitleOverTheHumanizedToken() throws {
		let titled = SirenAction(name: "update-status", href: "/x", method: "POST", title: "Mark as read", type: nil, fields: nil)
		let affordance = try XCTUnwrap(Affordance(action: titled))
		XCTAssertEqual(affordance.label, "Mark as read", "the server's title wins when present")
	}
}
