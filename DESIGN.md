# Expense Manager — DESIGN.md (iOS-native world)

## Thesis
A personal ledger should feel like it shipped with the phone: grouped settings-like
surfaces, a bottom tab bar, large titles, one blue. No marketing chrome, no dashboard
template tropes — the numbers and the review queue are the interface.

## Tokens (`styles.css` `:root`, mirrored in `.impeccable/design.json`)
- Type: `-apple-system, BlinkMacSystemFont, "SF Pro Text", …`; large titles 30–34px /
  700 / -0.02em; card titles 17px / 600; tabular numerals for all money.
- Light: grouped bg `#f2f2f7`, cards `#ffffff`, hairline separators, blue `#007aff`
  (fills use deeper `#0066cc` for 4.5:1 with white text).
- Dark (from `prefers-color-scheme`): bg `#000000`, cards `#1c1c1e`, text-blue
  `#57a8ff`, fills stay deep (`#0066cc` blue, `#e02020` red) for contrast.
- Radius 14 cards / 10 controls; iOS tint pills (green income, red expense,
  blue bank, orange cash, teal debit, purple credit).

## Components
- Top bar: sticky translucent blur + hairline, brandmark (blue squircle, ₹) + name.
- Desktop ≥901px: iOS-style sidebar (icon rows, blue-tint active). Mobile: bottom
  tab bar (blur, safe-area padding, 11px labels), sidebar hidden, hamburger removed.
- Cards are inset groups, never nested (subgroups use hairline dividers).
- Buttons: filled blue / gray-fill ghost / filled red danger; row actions borderless.
- Charts: area chart (ApexCharts, iOS palette, height matched to container) for
  trends; Top Categories is ranked HTML bars (crisp at any width, no lib risk).
- Focus rings, selection tint, themed caret/scrollbars; `prefers-reduced-motion` off-ramp.

## Ledger (Transactions surface, pinned direction)
- Dense day-grouped list: big date numeral, weekday pill (red Sundays), day
  income (blue) / expense (red) totals, rows with initial tile, note + category ·
  account subline, tabular blue/red amounts, quiet delete.
- Centered month pager (chevrons + month title; custom ranges labeled honestly),
  Income / Exp. / Total summary strip, coral FAB opening a bottom-sheet quick-add.
- Indian-format amounts (₹ 3,147.00). All dates computed in local time — UTC
  conversions shifted month boundaries for IST and were removed.
- Filters live behind a collapsible bar (funnel row, blue dot when narrowed);
  plain full-month views start collapsed, custom views stay open.

## Rules carried from review
- No emoji as icons (authored 1.7px stroke SVGs); ₹ and factual copy preserved.
- Heading order h1 → h2; tab labels ≥11px; fills hold 4.5:1 in both schemes.
- One accepted detector note: sticky-bar "cramped padding" heuristic (full-bleed
  bars with real 10/16px padding are correct iOS chrome).
