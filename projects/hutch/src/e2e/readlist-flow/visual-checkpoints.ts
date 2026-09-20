import assert from 'node:assert/strict'
import type { Page } from '@playwright/test'
import { expect, measuredBox, type VisualCheckpoint } from '@packages/e2e-harness'
import type { ReadlistFlowActionKey } from './action-catalog'

const EMPTY_READLIST_REGION = '[data-test-empty-readlist]'
const EMPTY_READLIST_TITLE = `${EMPTY_READLIST_REGION} [data-test-empty-title]`
const EMPTY_STATE_HORIZONTAL_PADDING_PX = 24
const PAGINATION_REGION = '[data-test-pagination]'
const PAGINATION_CONTROLS = '.readlist-pagination__controls'
const PAGINATION_INFO = '[data-test-pagination-info]'
const PAGINATION_NEXT_LINK = '[data-test-pagination-next]'

async function emptyReadlistSettled(page: Page): Promise<void> {
	await page.waitForSelector('body.page-readlist')
	await page.waitForSelector(EMPTY_READLIST_REGION)
}

async function emptyReadlistGeometry(page: Page): Promise<void> {
	const region = await measuredBox(page, EMPTY_READLIST_REGION)
	const title = await measuredBox(page, EMPTY_READLIST_TITLE)
	const leftInset = title.x - region.x
	const rightInset = region.x + region.width - (title.x + title.width)
	assert.ok(
		leftInset >= EMPTY_STATE_HORIZONTAL_PADDING_PX,
		`empty-state title must keep the region's horizontal padding, measured ${leftInset}px on the left`,
	)
	assert.ok(
		rightInset >= EMPTY_STATE_HORIZONTAL_PADDING_PX,
		`empty-state title must keep the region's horizontal padding, measured ${rightInset}px on the right`,
	)
	assert.equal(
		Math.round(leftInset),
		Math.round(rightInset),
		'the empty-state title must sit centred in its region',
	)
}

async function paginationPage1Settled(page: Page): Promise<void> {
	await page.waitForSelector('body.page-readlist')
	await page.waitForSelector(PAGINATION_NEXT_LINK)
	await expect(page.locator(PAGINATION_INFO)).toHaveText('Showing 20 of 21')
}

async function paginationPage1Geometry(page: Page): Promise<void> {
	const controls = await measuredBox(page, PAGINATION_CONTROLS)
	const nextLink = await measuredBox(page, PAGINATION_NEXT_LINK)
	assert.equal(
		nextLink.x + nextLink.width,
		controls.x + controls.width,
		'the Next link must sit on the controls right edge, where the page numbers cannot push it',
	)
}

const READLIST_FLOW_VISUAL_CHECKPOINTS: ReadonlyArray<[ReadlistFlowActionKey, VisualCheckpoint]> = [
	[
		'cleanup-previous-articles',
		{
			name: 'readlist-empty',
			settled: emptyReadlistSettled,
			geometry: emptyReadlistGeometry,
			target: EMPTY_READLIST_REGION,
			capture: 'element',
			pinnedText: [],
		},
	],
	[
		'verify-page1-has-next',
		{
			name: 'readlist-pagination-page-1',
			settled: paginationPage1Settled,
			geometry: paginationPage1Geometry,
			target: PAGINATION_REGION,
			capture: 'element',
			pinnedText: [],
		},
	],
]

export const visualCheckpoints = new Map<string, VisualCheckpoint>(READLIST_FLOW_VISUAL_CHECKPOINTS)

assert.equal(
	visualCheckpoints.size,
	READLIST_FLOW_VISUAL_CHECKPOINTS.length,
	'duplicate action key in READLIST_FLOW_VISUAL_CHECKPOINTS — a repeated key silently drops every checkpoint under it except the last',
)
