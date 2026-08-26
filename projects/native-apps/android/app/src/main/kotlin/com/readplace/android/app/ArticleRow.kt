package com.readplace.android.app

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.SubcomposeAsyncImage
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

	Row(
		modifier = modifier
			.fillMaxWidth()
			.clickable(onClick = onOpen)
			.padding(horizontal = 16.dp, vertical = 12.dp),
		horizontalArrangement = Arrangement.spacedBy(12.dp),
		verticalAlignment = Alignment.Top,
	) {
		Thumbnail(url = presentation.thumbnailUrl)

		Column(
			modifier = Modifier.weight(1f, fill = false),
			verticalArrangement = Arrangement.spacedBy(4.dp),
		) {
			Text(
				text = presentation.title,
				style = MaterialTheme.typography.titleMedium,
				maxLines = 2,
				overflow = TextOverflow.Ellipsis,
			)

			presentation.subtitle?.let { subtitle ->
				Text(
					text = subtitle,
					style = MaterialTheme.typography.bodySmall,
					color = MaterialTheme.colorScheme.onSurfaceVariant,
					maxLines = 1,
					overflow = TextOverflow.Ellipsis,
				)
			}

			presentation.excerpt?.let { excerpt ->
				Text(
					text = excerpt,
					style = MaterialTheme.typography.bodyMedium,
					color = MaterialTheme.colorScheme.onSurfaceVariant,
					maxLines = 2,
					overflow = TextOverflow.Ellipsis,
				)
			}
		}

		if (presentation.isRead) {
			Icon(
				imageVector = CheckmarkCircleFillGlyph,
				contentDescription = "Read",
				tint = LocalBrandColors.current.success,
				modifier = Modifier.size(16.dp),
			)
		}
	}
}

@Composable
private fun Thumbnail(url: String?) {
	val frame = Modifier
		.size(64.dp)
		.clip(RoundedCornerShape(8.dp))

	if (url != null) {
		SubcomposeAsyncImage(
			model = url,
			contentDescription = null,
			modifier = frame,
			contentScale = ContentScale.Crop,
			loading = { Placeholder() },
			error = { Placeholder() },
		)
	} else {
		Placeholder(modifier = frame)
	}
}

@Composable
private fun Placeholder(modifier: Modifier = Modifier) {
	Box(
		modifier = modifier
			.fillMaxSize()
			.background(MaterialTheme.colorScheme.surfaceVariant),
		contentAlignment = Alignment.Center,
	) {
		Icon(
			imageVector = DocTextGlyph,
			contentDescription = null,
			tint = MaterialTheme.colorScheme.outline,
		)
	}
}

private val CheckmarkCircleFillGlyph: ImageVector by lazy {
	materialGlyph(
		name = "CheckmarkCircleFill",
		pathData = "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 " +
			"1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z",
	)
}

private val DocTextGlyph: ImageVector by lazy {
	materialGlyph(
		name = "DocText",
		pathData = "M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 " +
			"16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z",
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
