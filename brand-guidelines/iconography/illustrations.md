### Illustrations

Spot illustrations lead an empty state, a reader notice, an advisory and an illustrated confirmation. They come from the shared illustrations module, never from the icon set. There are two drawings: the **book with a lightbulb** leads anything that is not a deletion, and the **bin holding a sheet** leads a deletion.

An illustration is filled art: a solid ink silhouette that shows as the outline, with flat shapes on top in at most four paints — ink (`currentColor`, which the container sets to `--foreground`), paper (`--card`), amber (`--color-brand`) and cream (`--color-brand-light`, only inside an ink outline). There are no strokes, washes, opacity, gradients or hex literals, so the art follows the reader's theme and any light pin.

Each drawing carries the size it was drawn at, 64px tall (the book 80×64, the bin 46×64). A container places the art and never scales it.

Illustrations are decorative (`aria-hidden`, `focusable="false"`), never emoji, raster or clip art, and carry no ids, because one page may inline the bin once per card. The accent stays amber even on a delete dialog; its confirmed action uses the dialog's amber `primary` button. A dialog that only edits (rename, create) has no illustration. Add a new drawing to that module, not at the call site, and only once a design uses it.
