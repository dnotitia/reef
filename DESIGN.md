# Reef Design System

## 1. Atmosphere & Identity

Reef feels like a dense, keyboard-first product command center for PM and engineering work. The signature is quiet teal precision: workspace surfaces stay neutral and compact, while teal marks primary action and focus, and purple is reserved for AI-specific affordances.

## 2. Color

### Palette

| Role | Token | Light | Dark | Usage |
|------|-------|-------|------|-------|
| Surface/base | `--background` | `hsl(0 0% 100%)` | `hsl(220 14% 8%)` | Page background |
| Surface/sidebar | `--surface-sidebar` | `hsl(220 13% 97%)` | `hsl(220 14% 6%)` | Primary app navigation |
| Surface/elevated | `--surface-elevated` | `hsl(0 0% 100%)` | `hsl(220 14% 11%)` | Cards, inputs, popovers |
| Surface/hover | `--surface-hover` | `hsl(220 13% 95%)` | `hsl(220 13% 14%)` | Hover and active rows |
| Surface/subtle | `--surface-subtle` | `hsl(220 13% 98%)` | `hsl(220 14% 10%)` | Quiet section backgrounds |
| Text/primary | `--foreground` | `hsl(220 13% 13%)` | `hsl(220 13% 95%)` | Main text |
| Text/muted | `--muted-foreground` | `hsl(220 9% 46%)` | `hsl(220 9% 65%)` | Captions, helper copy |
| Border/default | `--border` | `hsl(220 13% 91%)` | `hsl(220 13% 18%)` | Standard hairlines |
| Border/subtle | `--border-subtle` | `hsl(220 13% 93%)` | `hsl(220 13% 15%)` | Group dividers |
| Accent/brand | `--brand` | `hsl(173 80% 40%)` | `hsl(173 70% 45%)` | Focus, selected workspace, primary brand cues |
| Accent/AI | `--ai` | `hsl(260 70% 60%)` | `hsl(260 70% 70%)` | AI drafts and enrichment only |
| Status/done | `--status-done` | `hsl(150 65% 42%)` | `hsl(150 60% 50%)` | Completed status glyphs |
| Status/closed | `--status-closed` | `hsl(220 9% 50%)` | `hsl(220 9% 55%)` | Closed status glyphs |
| Error | `--destructive` | `hsl(0 75% 55%)` | `hsl(0 60% 55%)` | Destructive and validation messages |

### Rules

- Use Tailwind v4 theme tokens mapped in `packages/web/src/app/globals.css`.
- Brand teal is functional, not decorative. Purple stays AI-specific.
- Status, priority, type, severity, due, and dependency colors are glyph colors, not fill backgrounds.

## 3. Typography

### Scale

| Level | Size | Weight | Line Height | Tracking | Usage |
|-------|------|--------|-------------|----------|-------|
| Page title | `text-xl` to `text-2xl` | 600 | Tight | 0 | Main app page headers |
| Group title | `15px` | 600 | Normal | 0 | Settings group headings |
| Section label | `13px` | 600 | Normal | Wide uppercase | Settings section labels |
| Body | `14px` | 400 | Normal | 0 | Dense app text |
| Caption | `12px` | 400 to 500 | Normal | 0 | Helper copy and metadata |
| Mono value | `13px` | 400 | Normal | 0 | IDs, prefixes, branch-like values |

### Font Stack

- Primary: `var(--font-inter), ui-sans-serif, system-ui, sans-serif`
- Display: same Inter variable face with weight-based distinction
- Mono: `var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace`

### Rules

- Keep app UI compact. Hero-scale type does not belong inside dashboard panels.
- Body text in routed product surfaces should not drop below 12px captions or 14px body copy.

## 4. Spacing & Layout

### Base Unit

All spacing follows Tailwind's 4px scale.

| Token | Value | Usage |
|-------|-------|-------|
| `gap-1` | 4px | Tight label stacks |
| `gap-2` | 8px | Inline controls |
| `gap-3` | 12px | Form field groups |
| `gap-4` | 16px | Compact panel internals |
| `gap-6` | 24px | Settings group header to content |
| `gap-8` | 32px | Settings sections |

### Grid

- Product pages use constrained inner content through shared layout components, not floating section cards.
- Settings pages are narrow, single-column forms optimized for scanning and repeated edits.

### Rules

- Prefer existing shared components (`Button`, `Input`, `Skeleton`, field leaves) before adding new patterns.
- Keep fixed-format controls stable with explicit widths where labels or values can change.

## 5. Components

### Settings Group

- Structure: group header with title, optional scope, optional access badge, description, hairline, then a vertical stack of sections.
- Spacing: `gap-6` outer group, `gap-8` section stack, `gap-3` inside each setting.
- States: access badge omitted while role is resolving.
- Accessibility: heading accessible name stays the group title; scope name is sibling text.

### Settings Editor Row

- Structure: label and helper copy followed by one or more controlled inputs and a `Save` button.
- States: skeleton while loading, inline alert on validation or save failure, read-only text for users without write access.
- Accessibility: input labels are explicit, invalid state sets `aria-invalid`, save buttons disable when unchanged or saving.

## 6. Motion & Interaction

| Type | Duration | Easing | Usage |
|------|----------|--------|-------|
| Micro | `--duration-fast` 120ms | `--ease-signature` | Button and row hover |
| Standard | `--duration-base` 150ms | `--ease-signature` | Sort and filter transitions |
| Emphasis | `--duration-slow` 500ms | `--ease-signature` | Drag/drop settle |

### Rules

- Animate color, opacity, and transform. Avoid layout animation unless a shared library already owns the interaction.
- Every interactive control needs visible hover and focus affordances.

## 7. Depth & Surface

### Strategy

Reef uses borders plus tonal shift. Hairlines separate dense work areas; elevated surfaces are subtle and shadowless by default.

| Type | Value | Usage |
|------|-------|-------|
| Default border | `1px solid var(--border)` | Inputs, cards, tables |
| Subtle border | `1px solid var(--border-subtle)` | Settings group dividers |
| Elevated surface | `var(--surface-elevated)` | Inputs and popovers |
| Hover surface | `var(--surface-hover)` | Button and row hover |

### Rules

- Do not add decorative shadows or gradient backgrounds to operational surfaces.
- Cards are for repeated items, dialogs, and framed tools. Page sections stay unframed unless the existing component already frames them.
