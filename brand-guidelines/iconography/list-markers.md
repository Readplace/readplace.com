### List Markers

List markers carry polarity. An included / positive item takes the `check` icon in `--success-text`; an excluded / negative item — a "what this will **not** do" list — takes the `x` icon in `--muted-foreground` (or `--color-error` for a louder refusal). Never mark an exclusion list with a neutral dash or bullet — a dash reads as a feature, not a refusal.

A divided list whose rows carry their own title line takes no marker. A numbered explainer (the import page's How it works) marks each step with a 24px `--secondary` circle holding a 14px/500 `--primary-text-on-tint` digit from a CSS counter, 16px above the step's title. Its rows sit inside the card's 24px padding, so their hairlines are inset.

**Item state uses one vocabulary.**

- **Waiting or current** is a small filled CSS dot (8px): `--primary-text` for an unread item, and `--foreground` inside a 1.25px `--foreground` ring for the current step of a sequence. A current step with measured progress uses the quarter pie in [Progress and Steppers](../components/progress-and-steppers.md#progress-and-steppers).
- **Done** is the `check` icon in the success colour: `--success-text` beside text, or a white `--success-foreground` check on a `--success` disc inside a `--success` ring for a completed step.
- **Not yet reached** is a 1.25px dashed `--muted-foreground` ring; steps are joined by a 1px dashed `--muted-foreground` connector.
- An inline state marker beside wrapping text sits in a box one line tall, so it stays on the first line and is never centred against a wrapped block.
- A marker that carries meaning alone has an `.sr-only` twin.
