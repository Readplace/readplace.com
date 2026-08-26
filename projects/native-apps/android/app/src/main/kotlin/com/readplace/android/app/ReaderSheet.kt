@file:OptIn(ExperimentalMaterial3Api::class)

package com.readplace.android.app

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import okhttp3.Cookie

/**
 * The reader sheet. It opens immediately on tap and shows a skeleton of the
 * article while the cookie session is minted from the bearer, then swaps in the
 * authenticated web view. If the bootstrap fails it shows a standard "couldn't
 * open" view rather than a blank page. Splitting the wait out of the tap keeps
 * tapping a row instantly responsive, like following a link.
 */
@Composable
fun ReaderSheet(
	readerUrl: String,
	mintSession: suspend () -> ReaderSessionMint,
	reduceMotion: Boolean,
	onMarkedRead: () -> Unit,
	onCaptureBlocked: suspend () -> Unit,
	onClose: () -> Unit,
	onLogout: () -> Unit,
	onOpenExternally: (String) -> Unit,
) {
	var bootstrap by remember { mutableStateOf<ReaderBootstrap>(ReaderBootstrap.Loading) }
	var loadPhase by remember { mutableStateOf<ReaderLoadPhase>(ReaderLoadPhase.Loading) }
	val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
	val scope = rememberCoroutineScope()

	fun leaving(then: () -> Unit): () -> Unit = {
		scope.launch { sheetState.hide() }.invokeOnCompletion { then() }
	}

	LaunchedEffect(Unit) {
		bootstrap = ReaderBootstrap.after(mintSession())
	}

	ModalBottomSheet(
		onDismissRequest = onClose,
		sheetState = sheetState,
		containerColor = MaterialTheme.colorScheme.surface,
	) {
		Box(modifier = Modifier.fillMaxSize()) {
			when (val current = bootstrap) {
				is ReaderBootstrap.Ready -> Reader(
					url = readerUrl,
					cookies = current.cookies,
					loadPhase = loadPhase,
					reduceMotion = reduceMotion,
					onLoadPhaseChange = { loadPhase = it },
					onMarkedRead = leaving(onMarkedRead),
					onCaptureBlocked = onCaptureBlocked,
					onClose = leaving(onClose),
					onLogout = leaving(onLogout),
					onOpenExternally = onOpenExternally,
				)
				ReaderBootstrap.Unavailable -> ReaderUnavailable(onClose = leaving(onClose))
				ReaderBootstrap.Loading -> ReaderSkeleton(reduceMotion = reduceMotion)
			}
		}
	}
}

/**
 * The web view with its loading chrome layered over it: the skeleton keeps covering
 * the page from the tap through the real page load (not just the session mint),
 * lifting the moment content paints, while a thin progress bar tracks the web
 * view's actual reported progress.
 */
@Composable
private fun Reader(
	url: String,
	cookies: List<Cookie>,
	loadPhase: ReaderLoadPhase,
	reduceMotion: Boolean,
	onLoadPhaseChange: (ReaderLoadPhase) -> Unit,
	onMarkedRead: () -> Unit,
	onCaptureBlocked: suspend () -> Unit,
	onClose: () -> Unit,
	onLogout: () -> Unit,
	onOpenExternally: (String) -> Unit,
) {
	val overlay = ReaderLoad.overlay(loadPhase)
	Box(modifier = Modifier.fillMaxSize()) {
		ReaderWebView(
			url = url,
			cookies = cookies,
			onMarkedRead = onMarkedRead,
			onCaptureBlocked = onCaptureBlocked,
			onClose = onClose,
			onLogout = onLogout,
			onOpenExternally = onOpenExternally,
			onLoadPhaseChange = onLoadPhaseChange,
			modifier = Modifier.fillMaxSize(),
		)

		AnimatedVisibility(
			visible = loadPhase == ReaderLoadPhase.Failed,
			enter = fadeIn(tween(durationMillis = 300)),
			exit = fadeOut(tween(durationMillis = 300)),
		) {
			ReaderUnavailable(onClose = onClose)
		}
		AnimatedVisibility(
			visible = overlay.showsSkeleton,
			enter = fadeIn(tween(durationMillis = 300)),
			exit = fadeOut(tween(durationMillis = 300)),
		) {
			ReaderSkeleton(reduceMotion = reduceMotion)
		}
		AnimatedVisibility(
			visible = overlay.showsProgressBar,
			enter = fadeIn(tween(durationMillis = 350)),
			exit = fadeOut(tween(durationMillis = 350)),
		) {
			ReaderLoadingBar(progress = overlay.progress)
		}
	}
}

/**
 * A slim determinate bar pinned to the top of the reader, filled to the web view's
 * real reported progress so a slow article shows measurable movement instead of a
 * blank wait. The native linear indicator owns its own fill, so it starts empty
 * and grows from the left — no first-frame flash to full width that a custom fill
 * inherits from the sheet's present animation. Amber because it is chrome; the
 * reading surface stays neutral. Hidden from accessibility — the skeleton already
 * announces the load.
 */
@Composable
private fun ReaderLoadingBar(progress: Double) {
	LinearProgressIndicator(
		progress = { progress.coerceIn(0.0, 1.0).toFloat() },
		modifier = Modifier
			.fillMaxWidth()
			.clearAndSetSemantics {},
		color = LocalBrandColors.current.amber,
		gapSize = 0.dp,
		drawStopIndicator = {},
	)
}

/**
 * A placeholder that previews the reader's shape (title, byline, body lines) while
 * it loads. A gradient sweep signals ongoing work without the content-free spin of
 * a progress indicator, mirroring the web's loading skeleton; the sweep is dropped
 * under Reduce Motion, leaving the static gray shape. The neutral fill keeps the
 * reading surface free of brand colour — the amber lives in the bar.
 */
@Composable
private fun ReaderSkeleton(reduceMotion: Boolean) {
	// A translucent highlight band swept left-to-right across each bar. Removed
	// entirely (not just paused) under Reduce Motion so no animation is scheduled.
	val sweep: State<Float>? = if (reduceMotion) {
		null
	} else {
		rememberInfiniteTransition(label = "reader-skeleton").animateFloat(
			initialValue = -1f,
			targetValue = 1f,
			animationSpec = infiniteRepeatable(
				animation = tween(durationMillis = 1300, easing = LinearEasing),
				repeatMode = RepeatMode.Restart,
			),
			label = "reader-skeleton-sweep",
		)
	}
	Column(
		modifier = Modifier
			.fillMaxSize()
			.background(MaterialTheme.colorScheme.surface)
			.padding(24.dp)
			.semantics(mergeDescendants = true) { contentDescription = "Opening reader" },
		verticalArrangement = Arrangement.spacedBy(14.dp),
	) {
		SkeletonBar(width = null, height = 30.dp, sweep = sweep)
		SkeletonBar(width = 160.dp, height = 16.dp, sweep = sweep)
		Column(
			modifier = Modifier.padding(top = 10.dp),
			verticalArrangement = Arrangement.spacedBy(10.dp),
		) {
			repeat(7) { SkeletonBar(width = null, height = 12.dp, sweep = sweep) }
			SkeletonBar(width = 200.dp, height = 12.dp, sweep = sweep)
		}
	}
}

@Composable
private fun SkeletonBar(width: Dp?, height: Dp, sweep: State<Float>?) {
	val span = if (width == null) Modifier.fillMaxWidth() else Modifier.width(width)
	Box(
		modifier = Modifier
			.then(span)
			.height(height)
			.clip(RoundedCornerShape(6.dp))
			.background(MaterialTheme.colorScheme.surfaceContainerHighest)
			.drawWithContent {
				drawContent()
				if (sweep != null) {
					val start = sweep.value * size.width
					drawRect(
						brush = Brush.horizontalGradient(
							colors = listOf(Color.Transparent, Color.White.copy(alpha = 0.35f), Color.Transparent),
							startX = start,
							endX = start + size.width,
						),
					)
				}
			},
	)
}

/**
 * The standard view shown when the reader can't be opened (the session couldn't be
 * minted, or the server returned nothing the client can show). Gives the user a
 * way out instead of a blank sheet.
 */
@Composable
private fun ReaderUnavailable(onClose: () -> Unit) {
	Column(
		modifier = Modifier
			.fillMaxSize()
			// Opaque so that, layered over a failed page load, the broken page does not
			// show through; a no-op against the sheet's own background when shown alone.
			.background(MaterialTheme.colorScheme.surface)
			.padding(40.dp),
		verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
		horizontalAlignment = Alignment.CenterHorizontally,
	) {
		Icon(
			imageVector = WifiSlashGlyph,
			contentDescription = null,
			modifier = Modifier.size(40.dp),
			tint = MaterialTheme.colorScheme.onSurfaceVariant,
		)
		Text(text = "Couldn't open the reader", style = MaterialTheme.typography.titleMedium)
		Text(
			text = "Check your connection and try again.",
			style = MaterialTheme.typography.bodyMedium,
			color = MaterialTheme.colorScheme.onSurfaceVariant,
			textAlign = TextAlign.Center,
		)
		Button(
			onClick = onClose,
			colors = ButtonDefaults.buttonColors(containerColor = LocalBrandColors.current.amber),
			modifier = Modifier.padding(top = 4.dp),
		) {
			Text(text = "Close")
		}
	}
}

private val WifiSlashGlyph: ImageVector by lazy {
	materialGlyph(
		name = "WifiSlash",
		pathData = "M22.99 9C19.15 5.16 13.8 3.76 8.84 4.78l2.52 2.52c3.47-.17 6.99 1.05 9.63 3.7l2-2zm-4 " +
			"4c-1.29-1.29-2.84-2.13-4.49-2.56l3.53 3.53.96-.97zM2 3.05L5.07 6.1C3.6 6.82 2.22 7.78 1 " +
			"9l1.99 2c1.24-1.24 2.67-2.16 4.2-2.77l2.24 2.24C7.81 10.89 6.27 11.73 5 13v.01L6.99 " +
			"15c1.36-1.36 3.14-2.04 4.92-2.06L18.98 20l1.27-1.26L3.29 1.79 2 3.05zM9 17l3 3 " +
			"3-3c-1.65-1.66-4.34-1.66-6 0z",
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
