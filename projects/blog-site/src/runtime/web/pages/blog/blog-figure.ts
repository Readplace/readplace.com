import { parseFigure } from "./blog-figure.parse";
import { renderFigure } from "./blog-figure.render";

export function drawFigure(body: string, index: number): string {
	return renderFigure(parseFigure(body), index);
}
