# {{vault}} Guide

> Edit this document to describe how agents should write into this vault.
> Until you do, it acts as the AKB-default template — agents fall back to
> general AKB conventions (browse before write, no inline secrets, etc.).

## Purpose

(Describe what this vault is for and what it is not for. One paragraph.)

## Document types

Use these types when writing documents. Skip the rest unless the body explicitly calls for them.

- note — lightweight record
- report — synthesized analysis
- decision — durable decision with rationale
- spec — technical or product specification
- plan — future work
- session — agent session record
- task — assignment
- reference — stable reference material
- skill — vault-level conventions (owner-maintained; one per vault, this very doc)

## Tag conventions

- topic:<slug> — concept grouping
- source:<system> — imported source family
- area:<slug> — organizational area

## Collections

(Optional — list collections and their write policy here. Vault owner can
free-form this section. Agents read it as context, not a hard schema.)

## Relation rules

- Structured relations stay inside this vault. For a cross-vault citation,
  use an ordinary Markdown link; it remains content and is not a graph edge.
- depends_on — one resource cannot be understood without another
- implements — code/spec realizes a designed behavior
- references — background citation
- related_to — soft association, no directional dependency
- attached_to — file or table belongs to its document
- derived_from — generated/curated work depends on source material

## Document Template

When creating a new document, use this as a starting structure:

```markdown
---
title: <Document Title>
type: note|report|decision|spec|plan|session|reference
tags: [topic:<slug>, source:<system>]
---

# <Document Title>

## Purpose
<Why this exists. 1-2 sentences.>

## Background
<Context, constraints.>

## Decision / Result
<Core content.>

## Verification
<How it was checked.>

## Related
<Links to other docs via akb_link or inline markdown.>
```

## Do not

- Inline secrets in bodies; use ${{secrets.X}} placeholders
- Edit auto-generated docs without checking provenance
