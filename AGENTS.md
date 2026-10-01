## Conventions

The following commands are used to enforce repository conventions:
- `pnpm fmt`
- `pnpm lint`
- `pnpm typecheck`

### Options

Prefer Option<T> over T | undefined. Only convert an Option<T> to T | undefined at the boundary, where third-party code does not accept Option<T>.

### Function signatures

- Avoid signatures with more than three positional parameters; group related inputs into a named options object.
- Do not use two positional parameters of the same type, since callers can accidentally swap them.

## Supabase CLI

Use the repo-local supabase CLI via `pnpm exec supabase`. Do not call global `supabase`.

## Vendored Repositories

This project vendors external repositories under @repos/

- Use vendored repositories as read-only reference material when working with related libraries
- Prefer examples and patterns from the vendored source code over generated guesses or web search results
- Do not edit files under @repos/ unless explicitly asked
- Do not import from @repos/ - application code should continue importing from normal package dependencies

