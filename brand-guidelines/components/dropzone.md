### Dropzone

The import page's file picker is a dropzone. The whole box is the file input's `<label>`, with no link styling: a `--muted` fill, a 1px dashed `--border`, `--radius` corners and 24px padding, its parts centred 16px apart.

- **Glyph.** A 40px `--card` disc with a 1px `--border` ring holds the 16px `upload` glyph in `--foreground`.
- **Text.** "Choose a file or drag it here" is 16px/400 `--foreground`. The meta 8px under it is 14px/400 `--muted-foreground` and names the formats and the caps, taken from their constants.
- **States.** Hover and `:focus-within` turn the border `--color-brand` and the fill `--secondary`; dragover makes the border solid; keyboard focus draws the 2px `--ring` outline 2px outside the box. A chosen file's name replaces the meta and the form submits; while it uploads, the progress pair and its label replace the box and its button.
