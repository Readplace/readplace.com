import SwiftUI

private struct IdentifiableURL: Identifiable {
	let id = UUID()
	let url: URL
}

struct ReadingListView: View {
	@ObservedObject var session: AppSession
	@StateObject private var viewModel: ReadingListViewModel

	@State private var openURL: IdentifiableURL?
	@State private var showingSaveDialog = false
	@State private var saveText = ""

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
					ToolbarItem(placement: .navigationBarTrailing) {
						Button {
							saveText = ""
							showingSaveDialog = true
						} label: {
							Image(systemName: "plus")
						}
					}
				}
				.refreshable { await viewModel.refresh() }
				.task { await viewModel.loadIfNeeded() }
				.sheet(item: $openURL) { item in
					SafariView(url: item.url).ignoresSafeArea()
				}
				.alert("Save a URL", isPresented: $showingSaveDialog) {
					TextField("https://example.com/article", text: $saveText)
						.textInputAutocapitalization(.never)
						.autocorrectionDisabled()
					Button("Save") { Task { await viewModel.saveURL(saveText) } }
					Button("Cancel", role: .cancel) {}
				} message: {
					Text("Saves the URL only. Use the iOS Share Sheet to save a page with its rendered content.")
				}
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

			if viewModel.isSaving {
				ProgressView("Saving…")
					.padding()
					.background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
			}
		}
		.overlay(alignment: .bottom) {
			if let errorText = viewModel.errorText {
				banner(errorText, color: .red) { viewModel.errorText = nil }
			} else if let warningText = viewModel.warningText {
				banner(warningText, color: .orange) { viewModel.warningText = nil }
			}
		}
	}

	private var list: some View {
		List {
			ForEach(viewModel.articles) { article in
				ArticleRow(article: article)
					.contentShape(Rectangle())
					.onTapGesture {
						if let url = URL(string: article.url) { openURL = IdentifiableURL(url: url) }
					}
					.swipeActions(edge: .trailing) {
						Button(role: .destructive) {
							Task { await viewModel.delete(article) }
						} label: {
							Label("Delete", systemImage: "trash")
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

	private var emptyState: some View {
		VStack(spacing: 12) {
			Image(systemName: "tray")
				.font(.system(size: 44))
				.foregroundStyle(.secondary)
			Text("Nothing saved yet")
				.font(.headline)
			Text("Share a link to Readplace, or tap + to save a URL.")
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
