---
name: git-commit
description: >-
    Create atomic and revertable commits with scoped commits format.
    Use when finalizing your work.
    Do not use if you cannot confirm the changes are correct.
---

## Steps

1. Read current status
   - `git status --short`, `git diff HEAD`, and `git log --oneline -5`
2. Examine each hunk separately
3. Group these hunks into atomic and revertable change units
   - If a change contains multiple concerns, split it into separate units
4. Create a commit for each change unit
   - If a change replaces the previous commit, you can amend it with `git commit --amend`

## Commands

### Commit

NEVER use `git commit -m`; use `git commit --file` instead.

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
- `<scope>` - the relative path or package/module name that the commit touches. Use a hierarchical path when applicable (e.g.
  `core/in_port`, `playwright/lms/parser`).
- `<description>` - a short description of the changes made, in imperative mood, lowercased, with no trailing period.
- `[optional body]` - WHAT the changes are and WHY they were made. Include problem context, solution rationale, and any
  implementation decisions. Wrap at 72 characters.

Reverts, merges, and other special commits can be formatted however you like.

## Hierarchical Scopes

When a project has a deep directory structure, use a hierarchical scope to identify the affected area:

```
<top-level>/<subdirectory>: <description>
```

If there is deep nesting (e.g. `desktop/client/components/button: <description>`), truncate to a meaningful level (e.g.
`desktop: button: <description>`). If the change affects many subdirectories, abbreviate to just the top-level name.

## Multi-Scope Commits

If a commit covers multiple scopes:

- Use a more general scope that encompasses all relevant scopes
- List both scopes separated by a comma
- Use `*` for tree-wide changes
- If all else fails, treat it as a special commit and write a good description
