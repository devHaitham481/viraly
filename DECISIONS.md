# Decisions

Agents append open questions here and **keep working** under a stated assumption.
Blocking is reserved for questions where proceeding either way would be unsafe or would waste the work.

Format: question · assumption taken · what changes if the answer differs · who/when answered.

---

## Open

### D2 — Faithful record, or judgement?
- **Assumption taken:** faithful record for v1. Deferred to E-late (PRD §11.2).
- **If different:** changes how v1 words its output, not what it collects.
- **Status:** unanswered, non-blocking.

---

## Answered

### D1 — Apps-only for v1, or companies and websites too?
- **Assumption taken:** apps-only. Every cheap win found in research (JSON-LD ratings, archived store
  pages, version history, iTunes identity resolution) is app-specific.
- **If different:** `metrics` needs a web-mode variant (Trends, landing-page self-claims, headcount);
  identity resolution loses its strongest signal; PRD §11.4 becomes blocking.
- **Status:** unanswered. Contradicts the audience breadth in PRD §3.
- **Answered:** 2026-09-11 — recommendation accepted.

### D3 — Disambiguation UX: show candidates, or auto-pick top match?
- **Assumption taken:** show candidates. Cost of being wrong is an entire timeline about the wrong
  product, and the impostor HabitKit proves it is a live hazard.
- **If different:** E0's gate changes.
- **Status:** unanswered, blocks E0.
- **Answered:** 2026-09-11 — recommendation accepted.

_(none yet)_
