## Conventions

The following commands are used to enforce repository conventions:
- `pnpm fmt`
- `pnpm lint`
- `pnpm typecheck`

### Options

Prefer Option<T> over T | undefined. Only convert an Option<T> to T | undefined at the boundary, where third-party code does not accept Option<T>.

### Imports

Keep all imports at the top of the file. Use top-level `import type` or inline `type` specifiers for types. Do not use inline `import("...").Type` expressions or dynamic `import()` calls in the middle of a file, unless you specifically want runtime lazy-loading behavior.

### Branching

Do not use if statements, case switches, or ternaries where a Match.value would do. Match.value can ensure exhaustive matching even when we add new cases, where the other options could silently drop them.

### Function signatures

- Avoid signatures with more than three positional parameters; group related inputs into a named options object.
- Do not use two positional parameters of the same type, since callers can accidentally swap them.

### Update handlers

Manually spreading model fields and commands within update handler returns is an anti-pattern. Fold child submodels and state machines and/or use Update.combine instead.

### Tests

Story and scene tests should use the Foldkit `story()` and `scene()` patterns. Refer to the Foldkit testing documentation in the vendored repo.

## Supabase CLI

Use the repo-local supabase CLI via `pnpm exec supabase`. Do not call global `supabase`.

## Vendored Repositories

This project vendors external repositories under @repos/

- Use vendored repositories as read-only reference material when working with related libraries
- Prefer examples and patterns from the vendored source code over generated guesses or web search results
- Do not edit files under @repos/ unless explicitly asked
- Do not import from @repos/ - application code should continue importing from normal package dependencies
