@file:OptIn(ExperimentalMaterial3Api::class)

package com.readplace.android.app

import android.animation.ValueAnimator
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MenuDefaults
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.readplace.android.core.Affordance
import com.readplace.android.core.AppConfig
import com.readplace.android.core.Article
import com.readplace.android.core.ServerMessage
import com.readplace.android.core.SirenAction
import kotlinx.coroutines.launch
import java.time.Clock
import java.time.Instant
import java.time.ZoneId

/**
 * A destructive affordance awaiting confirmation. A destructive control (e.g.
 * `delete`) is irreversible, so it routes here for an explicit confirm before the
 * invoke fires, rather than acting on the tap. [article] is null for a
 * collection-level control, which acts on no row.
 */
private data class PendingDestructive(
	val label: String,
	val action: SirenAction,
	val article: Article?,
)

@Composable
fun ReadingListScreen(
	viewModel: ReadingListViewModel,
	now: Instant,
	onSignOut: () -> Unit,
	onOpenExternally: (String) -> Unit,
	isForeground: Boolean,
) {
	val state by viewModel.state.collectAsState()
	val scope = rememberCoroutineScope()
	val clock = remember(now) { Clock.fixed(now, ZoneId.systemDefault()) }
	val reduceMotion = remember { !ValueAnimator.areAnimatorsEnabled() }

	var showingAddInstructions by remember { mutableStateOf(false) }
	var pendingDestructive by remember { mutableStateOf<PendingDestructive?>(null) }
	var isRefreshing by remember { mutableStateOf(false) }

	LaunchedEffect(Unit) {
		viewModel.loadIfNeeded()
		viewModel.drainStagedUploads()
	}

	// Every return to the foreground re-reads, including transient dips (the
	// notification shade, a permission prompt): a share sheet can land a save
	// without the activity ever stopping, and the deliberate trade is a cheap
	// shallow re-read over a stale list.
	LaunchedEffect(isForeground) {
		if (!isForeground) return@LaunchedEffect
		launch { viewModel.handleForeground() }
		launch { viewModel.drainStagedUploads() }
	}

	/**
	 * Routes a tapped collection control to the side effect its advertised
	 * invocation calls for. The decision itself is pure (`ToolbarRoute.route`),
	 * including which sheet a control presents; this only performs the resulting
	 * effect, so the routing is unit-testable without a view.
	 */
	fun dispatch(affordance: Affordance) {
		when (val route = ToolbarRoute.route(affordance)) {
			ToolbarRoute.PresentAddLinksHelp -> showingAddInstructions = true
			is ToolbarRoute.Open -> viewModel.open(route.link)
			is ToolbarRoute.Invoke ->
				// A destructive collection control is irreversible, so route it through
				// the same confirmation the row controls use — keyed on `isDestructive`,
				// never on the action name — and only invoke once the user confirms. The
				// confirm gate lives here rather than in `ToolbarRoute.route` so routing
				// stays name-agnostic.
				if (affordance.presentation.isDestructive) {
					pendingDestructive = PendingDestructive(affordance.label, route.action, article = null)
				} else {
					scope.launch { viewModel.invokeCollection(route.action) }
				}
		}
	}

	/**
	 * Routes an item control to its effect: a navigable link opens in the web view
	 * (the same effect the toolbar gives a link), a destructive action awaits an
	 * explicit confirmation (its invoke is irreversible), and any other action
	 * invokes immediately through the view model's generic invoker. Which actions
	 * are destructive is a client-side presentation decision, not a name check. Every
	 * rendered item control resolves to an effect — a link-only affordance is opened,
	 * not silently dropped.
	 */
	fun activate(affordance: Affordance, article: Article) {
		when (val route = ItemRoute.route(affordance)) {
			is ItemRoute.Open -> viewModel.open(route.link)
			is ItemRoute.ConfirmDestructive ->
				pendingDestructive = PendingDestructive(affordance.label, route.action, article)
			is ItemRoute.Invoke -> scope.launch { viewModel.invoke(route.action, article) }
		}
	}

	/**
	 * Performs a confirmed destructive affordance. A row control invokes on its
	 * article; a collection control invokes on the collection.
	 */
	fun confirmDestructive(pending: PendingDestructive) {
		pendingDestructive = null
		val article = pending.article
		scope.launch {
			if (article != null) {
				viewModel.invoke(pending.action, article)
			} else {
				viewModel.invokeCollection(pending.action)
			}
		}
	}

	Scaffold(
		topBar = {
			TopAppBar(
				title = { Text(text = "Reading List") },
				navigationIcon = {
					TextButton(onClick = onSignOut) { Text(text = "Sign out") }
				},
				actions = {
					for (affordance in state.collectionAffordances) {
						ToolbarControl(affordance = affordance, onTap = { dispatch(affordance) })
					}
				},
			)
		},
	) { insets ->
		Box(
			modifier = Modifier
				.fillMaxSize()
				.padding(insets),
		) {
			PullToRefreshBox(
				isRefreshing = isRefreshing,
				onRefresh = {
					scope.launch {
						isRefreshing = true
						try {
							viewModel.refresh()
						} finally {
							isRefreshing = false
						}
					}
				},
				modifier = Modifier.fillMaxSize(),
			) {
				when {
					state.isLoading && state.articles.isEmpty() ->
						CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
					state.articles.isEmpty() -> EmptyState(modifier = Modifier.align(Alignment.Center))
					else -> ArticleList(
						state = state,
						clock = clock,
						onOpen = viewModel::openReader,
						onActivate = ::activate,
						onLoadMore = viewModel::loadMore,
					)
				}
			}

			val messages = state.messages
			val errorText = state.errorText
			val warningText = state.warningText
			val bottom = Modifier.align(Alignment.BottomCenter)
			if (messages.isNotEmpty()) {
				Banner(
					text = messages.joinToString(separator = "\n") { it.plainText },
					color = if (messages.any { it.kind == ServerMessage.Kind.ERROR }) {
						LocalBrandColors.current.error
					} else {
						LocalBrandColors.current.warning
					},
					onDismiss = viewModel::dismissMessages,
					modifier = bottom,
				)
			} else if (errorText != null) {
				Banner(
					text = errorText,
					color = LocalBrandColors.current.error,
					onDismiss = viewModel::dismissError,
					modifier = bottom,
				)
			} else if (warningText != null) {
				Banner(
					text = warningText,
					color = LocalBrandColors.current.warning,
					onDismiss = viewModel::dismissWarning,
					modifier = bottom,
				)
			}
		}
	}

	state.readerPresentation?.let { presentation ->
		key(presentation.id) {
			ReaderSheet(
				readerUrl = presentation.readerUrl,
				mintSession = viewModel::mintReaderSession,
				reduceMotion = reduceMotion,
				onMarkedRead = {
					scope.launch { viewModel.readerStatusChanged() }
					viewModel.closeReader()
				},
				onCaptureBlocked = viewModel::captureBlockedArticle,
				// The close path carries the probe: the sheet routes every dismissal —
				// including an interactive swipe-down or back press that never touches a
				// control — through it, so a session killed inside the sheet (the account
				// page's delete-account flow) is always discovered on close.
				onClose = {
					viewModel.closeReader()
					scope.launch { viewModel.handleWebSheetDismissal() }
				},
				// The account is gone, so a server-side revoke would only 401: the sign-out
				// the root wires here must drop the local credentials instead. The
				// dismissal probe may still fire and is idempotent — it 401s on the dead
				// session and funnels into this same sign-out.
				onLogout = {
					viewModel.closeReader()
					onSignOut()
				},
				onOpenExternally = onOpenExternally,
			)
		}
	}

	if (showingAddInstructions) {
		AddLinkInstructionsSheet(onDismiss = { showingAddInstructions = false })
	}

	pendingDestructive?.let { pending ->
		AlertDialog(
			onDismissRequest = { pendingDestructive = null },
			title = { Text(text = pending.label) },
			text = { Text(text = "This can't be undone.") },
			confirmButton = {
				TextButton(
					onClick = { confirmDestructive(pending) },
					colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
				) {
					Text(text = pending.label)
				}
			},
			dismissButton = {
				TextButton(onClick = { pendingDestructive = null }) { Text(text = "Cancel") }
			},
		)
	}
}

/**
 * Edge-to-edge like the reader/account sheet: the help page is chromeless and
 * renders its own back link, so it owns the full sheet.
 */
@Composable
private fun AddLinkInstructionsSheet(onDismiss: () -> Unit) {
	val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
	val scope = rememberCoroutineScope()
	ModalBottomSheet(
		onDismissRequest = onDismiss,
		sheetState = sheetState,
		containerColor = MaterialTheme.colorScheme.surface,
	) {
		Box(modifier = Modifier.fillMaxSize()) {
			AddLinkInstructions(
				baseUrl = AppConfig.serverBaseUrl,
				onDismiss = {
					scope.launch { sheetState.hide() }.invokeOnCompletion { onDismiss() }
				},
			)
		}
	}
}

@Composable
private fun ToolbarControl(affordance: Affordance, onTap: () -> Unit) {
	val presentation = affordance.presentation
	val tint = presentation.tint.resolved()
	if (presentation.showsTitle) {
		TextButton(
			onClick = onTap,
			colors = if (tint == null) {
				ButtonDefaults.textButtonColors()
			} else {
				ButtonDefaults.textButtonColors(contentColor = tint)
			},
		) {
			Icon(
				imageVector = presentation.icon.glyph,
				contentDescription = null,
				modifier = Modifier.size(ButtonDefaults.IconSize),
			)
			Spacer(modifier = Modifier.width(ButtonDefaults.IconSpacing))
			Text(text = affordance.label)
		}
	} else {
		IconButton(onClick = onTap) {
			Icon(
				imageVector = presentation.icon.glyph,
				contentDescription = affordance.label,
				tint = tint ?: LocalContentColor.current,
			)
		}
	}
}

@Composable
private fun ArticleList(
	state: ReadingListState,
	clock: Clock,
	onOpen: (Article) -> Unit,
	onActivate: (Affordance, Article) -> Unit,
	onLoadMore: suspend () -> Unit,
) {
	LazyColumn(modifier = Modifier.fillMaxSize()) {
		items(state.articles, key = { it.id }) { article ->
			ArticleItem(
				article = article,
				clock = clock,
				onOpen = { onOpen(article) },
				onActivate = { onActivate(it, article) },
			)
			HorizontalDivider(modifier = Modifier.padding(horizontal = 16.dp))
		}

		if (state.hasMore) {
			item(key = "load-more") {
				Box(
					modifier = Modifier
						.fillMaxWidth()
						.padding(16.dp),
					contentAlignment = Alignment.Center,
				) {
					CircularProgressIndicator()
				}
				LaunchedEffect(state.articles.size) { onLoadMore() }
			}
		}
	}
}

/**
 * One row with its per-item controls, rendered from the advertised affordances.
 * The label is the server's `title`; the icon, tint and destructive role are
 * derived client-side from the affordance's wire token. A full swipe can't fire a
 * control (it only reveals the tray), and a destructive control routes through a
 * confirmation before invoking; both guard the irreversible `delete`. Every
 * rendered control resolves to an effect in `activate` — an action invokes, a
 * link opens — so none silently no-ops.
 */
@Composable
private fun ArticleItem(
	article: Article,
	clock: Clock,
	onOpen: () -> Unit,
	onActivate: (Affordance) -> Unit,
) {
	val scope = rememberCoroutineScope()
	val swipe = rememberSwipeToDismissBoxState()
	var menuOpen by remember { mutableStateOf(false) }
	val controls = article.rowControls
	val collapse: () -> Unit = { scope.launch { swipe.reset() } }

	SwipeToDismissBox(
		state = swipe,
		enableDismissFromStartToEnd = false,
		backgroundContent = {
			RowControlsTray(
				controls = controls,
				onCollapse = collapse,
				onActivate = { affordance ->
					collapse()
					onActivate(affordance)
				},
			)
		},
	) {
		Box {
			ArticleRow(
				article = article,
				clock = clock,
				onOpen = onOpen,
				modifier = Modifier
					.background(MaterialTheme.colorScheme.surface)
					.semantics {
						customActions = controls.map { affordance ->
							CustomAccessibilityAction(affordance.label) {
								onActivate(affordance)
								true
							}
						}
					}
					.longPressAheadOfTap { menuOpen = true },
			)
			DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
				for (affordance in controls) {
					val presentation = affordance.presentation
					val tint = presentation.tint.resolved()
					DropdownMenuItem(
						text = { Text(text = affordance.label) },
						onClick = {
							menuOpen = false
							onActivate(affordance)
						},
						leadingIcon = { Icon(imageVector = presentation.icon.glyph, contentDescription = null) },
						colors = if (tint == null) {
							MenuDefaults.itemColors()
						} else {
							MenuDefaults.itemColors(textColor = tint, leadingIconColor = tint)
						},
					)
				}
			}
		}
	}
}

@Composable
private fun RowControlsTray(
	controls: List<Affordance>,
	onCollapse: () -> Unit,
	onActivate: (Affordance) -> Unit,
) {
	Row(
		modifier = Modifier
			.fillMaxSize()
			.background(MaterialTheme.colorScheme.surfaceContainerHighest)
			.clickable(
				interactionSource = remember { MutableInteractionSource() },
				indication = null,
				onClick = onCollapse,
			),
		horizontalArrangement = Arrangement.End,
	) {
		for (affordance in controls) {
			val presentation = affordance.presentation
			Column(
				modifier = Modifier
					.fillMaxHeight()
					.background(presentation.tint.resolved() ?: MaterialTheme.colorScheme.primary)
					.clickable(onClick = { onActivate(affordance) })
					.padding(horizontal = 16.dp),
				verticalArrangement = Arrangement.spacedBy(4.dp, Alignment.CenterVertically),
				horizontalAlignment = Alignment.CenterHorizontally,
			) {
				Icon(imageVector = presentation.icon.glyph, contentDescription = null, tint = Color.White)
				Text(text = affordance.label, style = MaterialTheme.typography.labelSmall, color = Color.White)
			}
		}
	}
}

private fun Modifier.longPressAheadOfTap(onLongPress: () -> Unit): Modifier =
	pointerInput(Unit) {
		awaitEachGesture {
			val down = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
			val slop = viewConfiguration.touchSlop
			val released = withTimeoutOrNull(viewConfiguration.longPressTimeoutMillis) {
				var held = true
				while (held) {
					val event = awaitPointerEvent(PointerEventPass.Initial)
					val change = event.changes.firstOrNull { it.id == down.id }
					held = change != null &&
						change.pressed &&
						(change.position - down.position).getDistance() <= slop
				}
			}
			if (released != null) return@awaitEachGesture
			onLongPress()
			var pressed = true
			while (pressed) {
				val event = awaitPointerEvent(PointerEventPass.Initial)
				for (change in event.changes) change.consume()
				pressed = event.changes.any { it.pressed }
			}
		}
	}

@Composable
private fun EmptyState(modifier: Modifier = Modifier) {
	Column(
		modifier = modifier.padding(40.dp),
		verticalArrangement = Arrangement.spacedBy(12.dp),
		horizontalAlignment = Alignment.CenterHorizontally,
	) {
		Icon(
			imageVector = Glyph.TRAY,
			contentDescription = null,
			modifier = Modifier.size(44.dp),
			tint = MaterialTheme.colorScheme.onSurfaceVariant,
		)
		Text(text = "Nothing saved yet", style = MaterialTheme.typography.titleMedium)
		Text(
			text = "Open a link in any app, tap Share, and choose Readplace. Tap + for help.",
			style = MaterialTheme.typography.bodyMedium,
			color = MaterialTheme.colorScheme.onSurfaceVariant,
			textAlign = TextAlign.Center,
		)
	}
}

@Composable
private fun Banner(text: String, color: Color, onDismiss: () -> Unit, modifier: Modifier = Modifier) {
	Row(
		modifier = modifier
			.padding(16.dp)
			.fillMaxWidth()
			.background(color, RoundedCornerShape(10.dp))
			.padding(12.dp),
		verticalAlignment = Alignment.CenterVertically,
	) {
		Text(
			text = text,
			style = MaterialTheme.typography.bodySmall,
			color = Color.White,
			modifier = Modifier.weight(1f),
		)
		IconButton(onClick = onDismiss) {
			Icon(imageVector = Glyph.CLOSE_CIRCLE, contentDescription = "Dismiss", tint = Color.White)
		}
	}
}

@Composable
private fun AffordanceTint.resolved(): Color? =
	when (this) {
		AffordanceTint.NEUTRAL -> null
		AffordanceTint.SUCCESS -> LocalBrandColors.current.success
		AffordanceTint.DESTRUCTIVE -> LocalBrandColors.current.error
	}

private val AffordanceIcon.glyph: ImageVector
	get() = when (this) {
		AffordanceIcon.PLUS -> Glyph.PLUS
		AffordanceIcon.KEY -> Glyph.KEY
		AffordanceIcon.CHECKMARK_CIRCLE -> Glyph.CHECKMARK_CIRCLE
		AffordanceIcon.TRASH -> Glyph.TRASH
		AffordanceIcon.MAGNIFYING_GLASS -> Glyph.MAGNIFYING_GLASS
		AffordanceIcon.PERSON_CIRCLE -> Glyph.PERSON_CIRCLE
		AffordanceIcon.ELLIPSIS_CIRCLE -> Glyph.ELLIPSIS_CIRCLE
	}

private object Glyph {
	val PLUS: ImageVector = materialGlyph(
		name = "Plus",
		pathData = "M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z",
	)
	val KEY: ImageVector = materialGlyph(
		name = "Key",
		pathData = "M12.65 10C11.83 7.67 9.61 6 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6c2.61 0 4.83-1.67 " +
			"5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z",
	)
	val CHECKMARK_CIRCLE: ImageVector = materialGlyph(
		name = "CheckmarkCircle",
		pathData = "M16.59 7.58L10 14.17l-3.59-3.58L5 12l5 5 8-8zM12 2C6.48 2 2 6.48 2 12s4.48 10 10 " +
			"10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z",
	)
	val TRASH: ImageVector = materialGlyph(
		name = "Trash",
		pathData = "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z",
	)
	val MAGNIFYING_GLASS: ImageVector = materialGlyph(
		name = "MagnifyingGlass",
		pathData = "M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 " +
			"9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 " +
			"0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z",
	)
	val PERSON_CIRCLE: ImageVector = materialGlyph(
		name = "PersonCircle",
		pathData = "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 " +
			"1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 " +
			"4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z",
	)
	val ELLIPSIS_CIRCLE: ImageVector = materialGlyph(
		name = "EllipsisCircle",
		pathData = "M6 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm12 0c-1.1 0-2 .9-2 2s.9 2 2 2 " +
			"2-.9 2-2-.9-2-2-2zm-6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z",
	)
	val TRAY: ImageVector = materialGlyph(
		name = "Tray",
		pathData = "M19 3H4.99c-1.11 0-1.98.89-1.98 2L3 19c0 1.1.88 2 1.99 2H19c1.1 0 2-.9 2-2V5c0-" +
			"1.11-.9-2-2-2zm0 12h-4c0 1.66-1.35 3-3 3s-3-1.34-3-3H4.99V5H19v10z",
	)
	val CLOSE_CIRCLE: ImageVector = materialGlyph(
		name = "CloseCircle",
		pathData = "M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm5 13.59L15.59 " +
			"17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z",
	)
}

private fun materialGlyph(name: String, pathData: String): ImageVector =
	ImageVector.Builder(
		name = name,
		defaultWidth = 24.dp,
		defaultHeight = 24.dp,
		viewportWidth = 24f,
		viewportHeight = 24f,
	).addPath(
		pathData = PathParser().parsePathString(pathData).toNodes(),
		fill = SolidColor(Color.Black),
	).build()
