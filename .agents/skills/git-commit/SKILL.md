---
name: git-commit
description: >-
    Split current changes into atomic and revertable change units and commit them using the scoped commit format.
    Use when finalizing your work.
    MUST NOT use if you cannot confirm the changes are correct.
---

## Steps

1. Read current status
   - `git status --short`, `git diff HEAD`, and `git log --oneline -10`
2. Examine each hunk separately
3. Distinguish changes that directly advance the goal from secondary changes made in response to their effects
   - Examples of secondary changes include an `core/out_port` adaptation necessitated by a Playwright limitation and
     tree-wide fixes caused by an `.oxlintrc.json` change.
4. Define atomic and revertable change units using only the direct changes as the basis
   - Do not use secondary changes to create, split, or combine change units.
   - Split units by WHERE they belong, not by WHAT they do.
   - Order the units chronologically according to the dependency flow. For example, core -> outbound adapters -> inbound
     adapters.
   - Make units as small as practical; do not make a unit broader than a package. Squash and fixup can be performed
     later.
5. Create a commit for each change unit in that order
   - Closely related changes in multiple areas may be one multi-scope commit.
   - If a change replaces the previous commit, you can amend it with `git commit --amend`

## Commands

### Commit

MUST NOT use `git commit -m`; use `git commit --file` instead.

```bash
# via stdin
git commit --file - <<'EOF'
<commit-message>
EOF

# from a file
git commit --file <temp-file>
```

## Format

```
<scope>: <description>

[optional body]

[optional trailer(s)]
```

- Keep the subject line under 72 characters.
- `<scope>` - the relative path or package name. Describe WHERE the commit touches, not WHAT.
- `<description>` - a short description of the changes made, in imperative mood, lowercased, with no trailing period.
- `[optional body]` - WHAT the changes are and WHY they were made. Include problem context, solution rationale, and any
  implementation decisions. Wrap at 72 characters.

Reverts, merges, and other special commits can be formatted however you like.

### Hierarchical Scopes

When a project has a deep directory structure, use a hierarchical scope to identify the affected area:

```
<top-level>/<subdirectory>: <description>
```

If there is deep nesting (e.g. `desktop/client/components/button: <description>`), truncate to a meaningful level (e.g.
`desktop: button: <description>`). If the change affects many subdirectories, abbreviate to just the top-level name.

### Multi-Scope Commits

If a commit covers multiple scopes:

- List both scopes separated by a comma
- Use `*` for tree-wide mechanical changes (not intended for regular use)
