### Status Panels and Stat Tiles

The readlist subscription notice reads top to bottom: an optional status chip, a sans title, one muted sentence, the evidence (a date or countdown), one full-width primary CTA, and at most one reassurance line under it. A **countdown or small statistic is a tile**: a `--muted` fill with 1px `--border`, `--radius` and 8px padding, the value first (16px/600, tabular numerals, `--foreground`) and its unit under it (14px/400, `--muted-foreground`), 8px between them. Tiles in a row share equal columns 8px apart.

The readlist subscription notice runs chip → 16 → title → 4 → sentence → 16 → evidence → 16 → CTA → 8 → reassurance line, inside 20px padding. Its CTA is a full-width primary at the M tier (40px).
