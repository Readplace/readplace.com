package com.readplace.poc.ui

import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ExitToApp
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.readplace.poc.app.ReadingListViewModel
import com.readplace.poc.core.ReadplaceApi
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch

/** The reading list — list, pull-to-refresh, infinite scroll, save-a-URL, open, and delete. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReadingListScreen(
	api: ReadplaceApi,
	onLogout: () -> Unit,
	onSessionExpired: () -> Unit,
) {
	val scope = rememberCoroutineScope()
	val context = LocalContext.current
	val viewModel = remember(api) { ReadingListViewModel(api, onSessionExpired) }
	val listState = rememberLazyListState()
	var urlField by remember { mutableStateOf("") }

	LaunchedEffect(viewModel) { viewModel.loadIfNeeded() }

	// Infinite scroll: fetch the next page as the last item scrolls into view.
	LaunchedEffect(listState, viewModel) {
		snapshotFlow { listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0 }
			.distinctUntilChanged()
			.collect { lastVisible ->
				if (viewModel.hasMore && lastVisible >= viewModel.articles.size - 3) {
					viewModel.loadMore()
				}
			}
	}

	Scaffold(
		topBar = {
			TopAppBar(
				title = { Text("Reading list") },
				actions = {
					IconButton(onClick = onLogout) {
						Icon(Icons.AutoMirrored.Filled.ExitToApp, contentDescription = "Sign out")
					}
				},
			)
		},
	) { padding ->
		Column(modifier = Modifier.padding(padding).fillMaxSize()) {
			Row(
				modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
				verticalAlignment = Alignment.CenterVertically,
			) {
				OutlinedTextField(
					value = urlField,
					onValueChange = { urlField = it },
					label = { Text("Save a URL") },
					singleLine = true,
					enabled = !viewModel.isSaving,
					keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go),
					modifier = Modifier.weight(1f),
				)
				IconButton(
					enabled = !viewModel.isSaving && urlField.isNotBlank(),
					onClick = {
						val toSave = urlField
						urlField = ""
						scope.launch { viewModel.saveUrl(toSave) }
					},
				) {
					Icon(Icons.Filled.Add, contentDescription = "Save URL")
				}
			}

			// Error wins over warning, one banner at a time — mirrors the iOS list.
			val errorText = viewModel.errorText
			val warningText = viewModel.warningText
			when {
				errorText != null -> Banner(errorText, MaterialTheme.colorScheme.error) {
					viewModel.errorText = null
				}
				warningText != null -> Banner(warningText, MaterialTheme.colorScheme.tertiary) {
					viewModel.warningText = null
				}
			}

			PullToRefreshBox(
				isRefreshing = viewModel.isLoading,
				onRefresh = { scope.launch { viewModel.refresh() } },
				modifier = Modifier.fillMaxSize(),
			) {
				LazyColumn(state = listState, modifier = Modifier.fillMaxSize()) {
					if (viewModel.articles.isEmpty() && !viewModel.isLoading) {
						item(key = "empty") { EmptyState() }
					}
					items(viewModel.articles, key = { it.id }) { article ->
						ArticleRow(
							article = article,
							onOpen = {
								runCatching {
									CustomTabsIntent.Builder().build()
										.launchUrl(context, Uri.parse(article.url))
								}
							},
							onDelete = { scope.launch { viewModel.delete(article) } },
						)
					}
				}
			}
		}
	}
}

@Composable
private fun EmptyState() {
	Column(
		modifier = Modifier.fillMaxWidth().padding(40.dp),
		horizontalAlignment = Alignment.CenterHorizontally,
	) {
		Icon(
			Icons.Outlined.Inbox,
			contentDescription = null,
			tint = MaterialTheme.colorScheme.onSurfaceVariant,
			modifier = Modifier.padding(bottom = 12.dp),
		)
		Text("Nothing saved yet", style = MaterialTheme.typography.titleMedium)
		Text(
			text = "Share a link to Readplace, or save a URL above.",
			style = MaterialTheme.typography.bodyMedium,
			color = MaterialTheme.colorScheme.onSurfaceVariant,
			textAlign = TextAlign.Center,
			modifier = Modifier.padding(top = 4.dp),
		)
	}
}

@Composable
private fun Banner(text: String, color: Color, onDismiss: () -> Unit) {
	Row(
		modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
		verticalAlignment = Alignment.CenterVertically,
	) {
		Text(
			text = text,
			color = color,
			style = MaterialTheme.typography.bodySmall,
			modifier = Modifier.weight(1f),
		)
		IconButton(onClick = onDismiss) {
			Icon(Icons.Filled.Close, contentDescription = "Dismiss", tint = color)
		}
	}
}
