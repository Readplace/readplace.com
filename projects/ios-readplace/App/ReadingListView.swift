import SwiftUI

struct ReadingListView: View {
	@ObservedObject var session: AppSession
	@StateObject private var viewModel: ReadingListViewModel

	@State private var showingAddInstructions = false
	@State private var saveText = ""
	/// The `save-article` action whose toolbar control was tapped, driving the
	/// native URL dialog. Non-nil presents the dialog; the action is carried
	/// through so the save follows it rather than rediscovering it by name.
	@State private var pendingSaveAction: SirenAction?
	/// A destructive item action awaiting confirmation, carried with the row it acts
	/// on. A destructive control (e.g. `delete`) is irreversible, so it routes here
	/// for an explicit confirm before the invoke fires, rather than acting on the tap.
	@State private var pendingDestructive: PendingDestructive?

	/// A destructive affordance paired with the row it would act on, so the
	/// confirmation dialog can invoke the exact action the swipe carried and label
	/// itself from the affordance's `label` (the server `title`, or the humanized
	/// fallback) rather than the raw wire name.
	private struct PendingDestructive: Identifiable {
		let affordance: Affordance
		let article: Article
		var id: String { "\(affordance.id):\(article.id)" }
	}

	init(session: AppSession) {
		self.session = session
		let api = session.makeAPI()
		_viewModel = StateObject(wrappedValue: ReadingListViewModel(
			api: api,
			onSessionExpired: { [weak session] in session?.forceLogout() }
		))
	}

	var body: some View {
		NavigationStack {
			content
				.navigationTitle("Reading List")
				.toolbar {
					ToolbarItem(placement: .navigationBarLeading) {
						Button("Sign out") { Task { await session.logout() } }
					}
					ToolbarItemGroup(placement: .navigationBarTrailing) {
						ForEach(viewModel.collectionAffordances) { affordance in
							Button {
								dispatch(affordance)
							} label: {
								Image(systemName: affordance.presentation.systemImage)
							}
							.tint(affordance.presentation.tint)
							.accessibilityLabel(affordance.label)
						}
					}
				}
				.refreshable { await viewModel.refresh() }
				.task { await viewModel.loadIfNeeded() }
				.sheet(item: $viewModel.readerPresentation) { presentation in
					ReaderSheet(
						presentation: presentation,
						mintSession: { await viewModel.mintReaderSession() },
						onMarkedRead: {
							if let id = presentation.articleId { viewModel.removeArticle(id: id) }
							viewModel.readerPresentation = nil
						},
						onClose: { viewModel.readerPresentation = nil }
					)
					.ignoresSafeArea()
				}
				.sheet(isPresented: $showingAddInstructions) {
					AddLinkInstructionsView(
						helpURL: viewModel.addLinksHelpURL,
						onClose: { showingAddInstructions = false }
					)
				}
				.alert("Save a URL", isPresented: Binding(
					get: { pendingSaveAction != nil },
					set: { if !$0 { pendingSaveAction = nil } }
				)) {
					TextField("https://example.com/article", text: $saveText)
						.textInputAutocapitalization(.never)
						.autocorrectionDisabled()
					Button("Save") {
						if let action = pendingSaveAction {
							Task { await viewModel.saveURL(saveText, action: action) }
						}
						pendingSaveAction = nil
					}
					Button("Cancel", role: .cancel) { pendingSaveAction = nil }
				} message: {
					Text("Saves the URL only. Use the iOS Share Sheet to save a page with its rendered content.")
				}
				.confirmationDialog(
					pendingDestructive?.affordance.label ?? "Are you sure?",
					isPresented: Binding(
						get: { pendingDestructive != nil },
						set: { if !$0 { pendingDestructive = nil } }
					),
					titleVisibility: .visible,
					presenting: pendingDestructive
				) { pending in
					Button(pending.affordance.label, role: .destructive) {
						if let action = pending.affordance.action {
							Task { await viewModel.invoke(action, on: pending.article) }
						}
						pendingDestructive = nil
					}
					Button("Cancel", role: .cancel) { pendingDestructive = nil }
				} message: { _ in
					Text("This can't be undone.")
				}
		}
	}

	/// Routes a tapped collection control to the side effect its advertised
	/// invocation calls for. The decision itself is pure (`ToolbarRoute.route`); this
	/// only performs the resulting effect, so the routing is unit-testable without a
	/// view.
	private func dispatch(_ affordance: Affordance) {
		// A navigable help link opens the server's add-links help sheet — a distinct
		// presentation from the reader. Mapping a known rel to its sheet is a
		// client presentation choice, not an availability gate.
		if affordance.token == "add-links-help" {
			showingAddInstructions = true
			return
		}
		switch ToolbarRoute.route(for: affordance) {
		case let .open(link):
			viewModel.open(link: link)
		case let .promptSave(action):
			saveText = ""
			pendingSaveAction = action
		case let .invoke(action):
			Task { await viewModel.invokeCollection(action) }
		}
	}

	@ViewBuilder
	private var content: some View {
		ZStack {
			if viewModel.isLoading && viewModel.articles.isEmpty {
				ProgressView()
			} else if viewModel.articles.isEmpty {
				emptyState
			} else {
				list
			}
		}
		.overlay(alignment: .bottom) {
			if !viewModel.messages.isEmpty {
				banner(
					viewModel.messages.map(\.plainText).joined(separator: "\n"),
					color: viewModel.messages.contains { $0.kind == .error } ? .brandError : .brandWarning
				) { viewModel.messages = [] }
			} else if let errorText = viewModel.errorText {
				banner(errorText, color: .brandError) { viewModel.errorText = nil }
			} else if let warningText = viewModel.warningText {
				banner(warningText, color: .brandWarning) { viewModel.warningText = nil }
			}
		}
	}

	private var list: some View {
		List {
			ForEach(viewModel.articles) { article in
				ArticleRow(article: article)
					.contentShape(Rectangle())
					.onTapGesture {
						viewModel.openReader(for: article)
					}
					.swipeActions(edge: .trailing, allowsFullSwipe: false) {
						ForEach(article.rowControls) { affordance in
							itemControl(affordance, on: article)
						}
					}
					.accessibilityActions {
						ForEach(article.rowControls) { affordance in
							Button(affordance.label) { activate(affordance, on: article) }
						}
					}
			}

			if viewModel.hasMore {
				HStack {
					Spacer()
					ProgressView()
					Spacer()
				}
				.listRowSeparator(.hidden)
				.onAppear { Task { await viewModel.loadMore() } }
			}
		}
		.listStyle(.plain)
	}

	/// One per-item swipe control, rendered from an advertised affordance. The label
	/// is the server's `title`; the icon, tint and destructive role are derived
	/// client-side from the affordance's wire token. A full swipe can't fire it
	/// (`allowsFullSwipe: false`), and a destructive control routes through a
	/// confirmation before invoking; both guard the irreversible `delete`. Every
	/// rendered control resolves to an effect in `activate` — an action invokes, a
	/// link opens — so none silently no-ops.
	private func itemControl(_ affordance: Affordance, on article: Article) -> some View {
		Button(role: affordance.presentation.isDestructive ? .destructive : nil) {
			activate(affordance, on: article)
		} label: {
			Label(affordance.label, systemImage: affordance.presentation.systemImage)
		}
		.tint(affordance.presentation.tint)
	}

	/// Routes an item control to its effect: a navigable link opens in the web view
	/// (the same effect the toolbar gives a link), a destructive action awaits an
	/// explicit confirmation (its invoke is irreversible), and any other action
	/// invokes immediately through the view model's generic invoker. Which actions
	/// are destructive is a client-side presentation decision, not a name check. Every
	/// rendered item control resolves to an effect — a link-only affordance is opened,
	/// not silently dropped.
	private func activate(_ affordance: Affordance, on article: Article) {
		guard let action = affordance.action else {
			if let link = affordance.link { viewModel.open(link: link) }
			return
		}
		if affordance.presentation.isDestructive {
			pendingDestructive = PendingDestructive(affordance: affordance, article: article)
		} else {
			Task { await viewModel.invoke(action, on: article) }
		}
	}

	private var emptyState: some View {
		VStack(spacing: 12) {
			Image(systemName: "tray")
				.font(.system(size: 44))
				.foregroundStyle(.secondary)
			Text("Nothing saved yet")
				.font(.headline)
			Text("Open a link in any app, tap Share, and choose Readplace. Tap + for help.")
				.font(.subheadline)
				.foregroundStyle(.secondary)
				.multilineTextAlignment(.center)
		}
		.padding(40)
	}

	private func banner(_ text: String, color: Color, onDismiss: @escaping () -> Void) -> some View {
		HStack {
			Text(text).font(.footnote).foregroundStyle(.white)
			Spacer()
			Button(action: onDismiss) { Image(systemName: "xmark.circle.fill").foregroundStyle(.white) }
		}
		.padding(12)
		.background(color, in: RoundedRectangle(cornerRadius: 10))
		.padding()
	}
}
