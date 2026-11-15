# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

## Project: static site starter (Vite → Cloudflare Workers static assets)

### Architecture (read README.md for the full picture)
- Pages are `src/**/*.html` (each becomes `/<path>`, e.g. `shop/x.html` → `/shop/x`). `_*.html` files are not built.
- Global components live in `src/partials/` and are inlined at BUILD time with `<include src="partials/x.html" attr="…">`
  (plugins/html-includes.js). Never fetch partials at runtime.
- Per-site settings: `site.config.js` (public). Secrets: `wrangler secret put` / `.dev.vars` only — never in the repo.
- Server code: `worker/` (only `/api/*` runs it). Prices ALWAYS come from `catalog/products.json` on the server.

### HTML
- Each `<section>` needs a unique `id`; target section styling via that id in `src/scss/sections/`.
- Every page uses partials/head.html with `title` + `description`; utility pages add `noindex="1"`.
- Images: plain `<img src="/assets/images/…" alt="…">`. The build creates `<picture>`/srcset/dimensions/lazy.
  Add `data-eager` to the LCP image, `sizes="…"` when not full-width. Don't hand-write `<picture>`.
- FAQ/accordions: native `<details name="group">`, no JS.

### CSS (SCSS)
- Theme via CSS custom properties in `scss/base/_tokens.scss`; fonts in `_fonts.scss` (woff2 only).
- Breakpoints only via `@include up(md)` / `@include down(md)` (sm 576, md 768, lg 992, xl 1200). No ad-hoc widths.
- Flex preferred over grid. Flex children: `flex: 0 1 ##%` (or calc), never fixed widths; 100% below `sm`.
- Units: `rem()`. No inline `style=""` or per-page `<style>` blocks.

### JS
- `src/js/main.js` + one module per component in `src/js/modules/`. Each module self-gates on its element.
- Rarely-used modules are lazy-imported from main.js by selector so pages only download what they use.
- No globals, no `var`, respect `prefers-reduced-motion`, keep everything working without JS where possible.

### Accessibility
- WCAG 2.1 AA. Run `npm run check` (build + axe on every page) before handing off; complete reports/accessibility-statement.md.
