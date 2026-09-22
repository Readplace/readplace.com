package com.readplace.android.app

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.SubcomposeAsyncImage
import coil3.compose.SubcomposeAsyncImageContent
import com.readplace.android.core.Article
import java.time.Clock

@Composable
fun ArticleRow(
	article: Article,
	clock: Clock,
	onOpen: () -> Unit,
	modifier: Modifier = Modifier,
) {
	val presentation = ArticlePresentation.of(article, clock)
	val brand = LocalBrandColors.current

	Column(
		modifier = modifier
			.fillMaxWidth()
			.clickable(onClick = onOpen)
			.padding(12.dp),
		verticalArrangement = Arrangement.spacedBy(8.dp),
	) {
		Row(
			horizontalArrangement = Arrangement.spacedBy(8.dp),
			verticalAlignment = Alignment.CenterVertically,
		) {
			ReadMarker(isRead = presentation.isRead, statusLabel = presentation.statusLabel)

			presentation.metaText?.let { metaText ->
				Text(
					text = metaText,
					style = MaterialTheme.typography.bodySmall,
					color = brand.textSecondary,
					maxLines = 1,
					overflow = TextOverflow.Ellipsis,
				)
			}
		}

		Row(verticalAlignment = Alignment.Top) {
			Column(
				modifier = Modifier.weight(1f),
				verticalArrangement = Arrangement.spacedBy(4.dp),
			) {
				Text(
					text = presentation.title,
					style = MaterialTheme.typography.titleMedium,
					// A read title is dimmed to the secondary text colour, the same signal
					// the read-state marker and card fill carry, so a read row recedes.
					color = if (presentation.isRead) brand.textSecondary else brand.textPrimary,
					maxLines = 2,
					overflow = TextOverflow.Ellipsis,
				)

				presentation.excerpt?.let { excerpt ->
					Text(
						text = excerpt,
						style = MaterialTheme.typography.bodyMedium,
						color = brand.textSecondary,
						maxLines = 2,
						overflow = TextOverflow.Ellipsis,
					)
				}
			}

			presentation.thumbnailUrl?.let { url -> Thumbnail(url = url) }
		}
	}
}

/**
 * The read-state marker that opens the metadata line: an amber dot while unread, a
 * green check once read. The shape — not colour alone — carries the state, and the
 * accessibility label speaks it, so the row reads under TalkBack and for colour-blind
 * readers.
 */
@Composable
private fun ReadMarker(isRead: Boolean, statusLabel: String) {
	val brand = LocalBrandColors.current
	if (isRead) {
		Icon(
			imageVector = CheckmarkGlyph,
			contentDescription = statusLabel,
			tint = brand.successText,
			modifier = Modifier.size(12.dp),
		)
	} else {
		Box(
			modifier = Modifier
				.size(8.dp)
				.clip(CircleShape)
				.background(brand.primaryText)
				.semantics { contentDescription = statusLabel },
		)
	}
}

/**
 * A 4:3 thumbnail on the row's trailing edge, at the 72×54 frame the iOS row uses.
 * A missing image URL paints no thumbnail (the caller omits this composable); a
 * pending load reserves the clear frame so a successful load doesn't shift the row,
 * and a failed load collapses the frame so the text reclaims the width — matching
 * iOS. The leading gap lives on the reserved/loaded frames alone, so a collapsed
 * frame leaves no gap behind.
 */
@Composable
private fun Thumbnail(url: String) {
	val frame = Modifier
		.padding(start = 12.dp)
		.width(72.dp)
		.height(54.dp)
	SubcomposeAsyncImage(
		model = url,
		contentDescription = null,
		contentScale = ContentScale.Crop,
		loading = { Box(modifier = frame) },
		success = { SubcomposeAsyncImageContent(modifier = frame.clip(RoundedCornerShape(8.dp))) },
		error = {},
	)
}

private val CheckmarkGlyph: ImageVector by lazy {
	materialGlyph(
		name = "Checkmark",
		pathData = "M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z",
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
