package com.readplace.poc.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material3.Card
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.readplace.poc.core.Article

/** One saved article, mirroring the iOS POC's `ArticleRow`: thumbnail, title, meta, excerpt. */
@Composable
fun ArticleRow(article: Article, onOpen: () -> Unit, onDelete: () -> Unit) {
	Card(
		modifier = Modifier
			.fillMaxWidth()
			.padding(horizontal = 16.dp, vertical = 6.dp)
			.clickable(onClick = onOpen),
	) {
		Row(
			modifier = Modifier.padding(12.dp),
			horizontalArrangement = Arrangement.spacedBy(12.dp),
		) {
			article.imageUrl?.let { imageUrl ->
				AsyncImage(
					model = imageUrl,
					contentDescription = null,
					contentScale = ContentScale.Crop,
					modifier = Modifier
						.size(64.dp)
						.clip(RoundedCornerShape(8.dp)),
				)
			}

			Column(modifier = Modifier.weight(1f)) {
				Text(
					text = article.title,
					style = MaterialTheme.typography.titleSmall,
					color = MaterialTheme.colorScheme.onSurface,
					maxLines = 2,
					overflow = TextOverflow.Ellipsis,
				)
				Text(
					text = metaLine(article),
					style = MaterialTheme.typography.labelSmall,
					color = MaterialTheme.colorScheme.primary,
					modifier = Modifier.padding(top = 2.dp),
				)
				article.excerpt?.let { excerpt ->
					Text(
						text = excerpt,
						style = MaterialTheme.typography.bodySmall,
						maxLines = 2,
						overflow = TextOverflow.Ellipsis,
						modifier = Modifier.padding(top = 4.dp),
					)
				}
			}

			IconButton(onClick = onDelete, modifier = Modifier.align(Alignment.Top)) {
				Icon(Icons.Outlined.Delete, contentDescription = "Delete")
			}
		}
	}
}

private fun metaLine(article: Article): String {
	val parts = buildList {
		article.siteName?.let { add(it) }
		article.readTimeMinutes?.let { add("$it min read") }
		if (article.isRead) add("Read")
	}
	return parts.joinToString(" · ")
}
