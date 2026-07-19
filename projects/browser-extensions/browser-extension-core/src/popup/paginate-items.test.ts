import { paginateItems } from "./paginate-items";

function createItems(count: number): string[] {
	return Array.from({ length: count }, (_, i) => `item-${i + 1}`);
}

describe("paginateItems", () => {
	it("should return all items when fewer than 10", () => {
		const items = createItems(5);

		const result = paginateItems(items, 1);

		expect(result.items).toEqual(items);
		expect(result.currentPage).toBe(1);
		expect(result.totalPages).toBe(1);
		expect(result.visiblePages).toEqual([1]);
	});

	it("should return exactly 10 items for the first page", () => {
		const items = createItems(25);

		const result = paginateItems(items, 1);

		expect(result.items).toHaveLength(10);
		expect(result.items[0]).toBe("item-1");
		expect(result.items[9]).toBe("item-10");
	});

	it("should return correct items for page 2", () => {
		const items = createItems(25);

		const result = paginateItems(items, 2);

		expect(result.items).toHaveLength(10);
		expect(result.items[0]).toBe("item-11");
		expect(result.items[9]).toBe("item-20");
	});

	it("should return remaining items on the last page", () => {
		const items = createItems(25);

		const result = paginateItems(items, 3);

		expect(result.items).toHaveLength(5);
		expect(result.items[0]).toBe("item-21");
		expect(result.items[4]).toBe("item-25");
	});

	it("should calculate totalPages correctly", () => {
		expect(paginateItems(createItems(1), 1).totalPages).toBe(1);
		expect(paginateItems(createItems(10), 1).totalPages).toBe(1);
		expect(paginateItems(createItems(11), 1).totalPages).toBe(2);
		expect(paginateItems(createItems(50), 1).totalPages).toBe(5);
		expect(paginateItems(createItems(51), 1).totalPages).toBe(6);
	});

	it("should clamp page to 1 when below range", () => {
		const result = paginateItems(createItems(20), 0);

		expect(result.currentPage).toBe(1);
		expect(result.items[0]).toBe("item-1");
	});

	it("should clamp page to totalPages when above range", () => {
		const result = paginateItems(createItems(20), 99);

		expect(result.currentPage).toBe(2);
		expect(result.items[0]).toBe("item-11");
	});

	it("should return 1 totalPage for empty list", () => {
		const result = paginateItems([], 1);

		expect(result.items).toEqual([]);
		expect(result.currentPage).toBe(1);
		expect(result.totalPages).toBe(1);
		expect(result.visiblePages).toEqual([1]);
	});

	describe("visiblePages", () => {
		it("should show all pages when 5 or fewer", () => {
			const result = paginateItems(createItems(50), 1);

			expect(result.visiblePages).toEqual([1, 2, 3, 4, 5]);
		});

		it("should show max 5 visible pages when more than 5 total", () => {
			const result = paginateItems(createItems(100), 1);

			expect(result.visiblePages).toHaveLength(5);
		});

		it("should center the current page in visible range", () => {
			const result = paginateItems(createItems(100), 5);

			expect(result.visiblePages).toEqual([3, 4, 5, 6, 7]);
		});

		it("should keep visible pages at the start when on first pages", () => {
			const result = paginateItems(createItems(100), 1);

			expect(result.visiblePages).toEqual([1, 2, 3, 4, 5]);
		});

		it("should keep visible pages at the end when on last pages", () => {
			const result = paginateItems(createItems(100), 10);

			expect(result.visiblePages).toEqual([6, 7, 8, 9, 10]);
		});

		it("should handle page 2 of many pages", () => {
			const result = paginateItems(createItems(100), 2);

			expect(result.visiblePages).toEqual([1, 2, 3, 4, 5]);
		});

		it("should handle page 9 of 10 pages", () => {
			const result = paginateItems(createItems(100), 9);

			expect(result.visiblePages).toEqual([6, 7, 8, 9, 10]);
		});
	});
});
