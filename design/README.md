# Design reference

The Figma screenshots this UI was built against belong here (login, scheduled
list, sent list, email detail, compose, and the recipient-chips state).

The implementation follows them: light surfaces, the green accent, the `ONB`
wordmark, the sidebar with profile card and Scheduled/Sent counts, amber time
pills on pending rows, the full-page composer with `Upload List` and the
`Send Later` popover, and the email detail view.

## Changing the theme

Every colour, radius and shadow is a CSS custom property in the `:root` block
of `frontend/src/app/globals.css`, mapped into Tailwind in
`frontend/tailwind.config.ts`. No component file references a raw value, so
retheming is an edit to that one block rather than a pass over components.

Key tokens:

| Token | Role |
|---|---|
| `--brand` | the green used for Compose, Send, links and active icons |
| `--brand-soft` | active nav background, Google button, recipient chips |
| `--scheduled-soft` / `--scheduled-fg` | amber time pill on pending rows |
| `--sent-soft` / `--sent-fg` | neutral pill on delivered rows |
| `--surface-muted` | search field, compose editor, From pill |
| `--border` | every hairline rule |
