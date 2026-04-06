---
title: "ADR: Two-Engine Architecture"
category: decision
tags: [adr, architecture, volume, momentum, hbme]
updated: 2026-04-06
sources: []
confidence: high
---

Two independent signal engines (VolumeTurtle + HBME) score independently and merge in the UI.

## Decision

**Date:** Pre-2026 (foundational)
**Status:** accepted

## Context

A single signal engine captures one market dynamic. Volume spikes detect institutional buying. Sector momentum detects rotational breakouts. These are complementary, not competing, edge sources.

## Decision

Run two fully independent engines:
1. **VolumeTurtle** — volume spike + price confirmation + regime overlay
2. **HBME** (High Beta Momentum Engine) — sector ranking + breakout detection

Both share the regime filter infrastructure but score independently with different component weights.

## Rationale

- Each engine has a distinct edge source (volume vs. momentum)
- Independent scoring prevents one engine from polluting the other
- Convergence (both engines flagging the same ticker) is a strong confirmation signal
- Easier to extend: new engines can be added without modifying existing ones

## Consequences

- Two scan pipelines to maintain
- UI must present both signal sources clearly
- Position sizing considers total open positions from both engines against the same cap

## See also

- [[volume-spike]]
- [[momentum-breakout]]
- [[composite-score]]
- [[breakout-power-score]]
