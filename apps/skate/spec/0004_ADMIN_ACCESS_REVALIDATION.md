# Keep confirmed admin access during revalidation

## Decision

Once the current authenticated user has received a successful admin access check returning `true`, keep the admin page usable while a later check is pending or fails. Revoke that access only when a current check succeeds with `false`, or when the authenticated session ends or changes user. A fresh user with no confirmed grant must still wait for a successful check before seeing admin content.

This changes the existing revalidation behavior described in `0003_ADMIN_SOURCES.md` under “Logout, user replacement, or revoked access”: a pending or failed revalidation no longer hides Sources or suspends its requests. An explicit denial still clears the Sources model and redirects away from Admin.

## Why this happens today

`src/main.ts` forwards every Supabase auth state event with a session into admin access revalidation. `AsyncData.revalidateOrLoad` changes `Success(true)` to `Refreshing(true)`. The shared `canAccessAdmin` helper currently accepts only `Success(true)`, so the page and all admin actions are gated while the request is pending. `src/page/admin/view.ts` replaces the admin content with “Checking admin access…”, removing the open create-source dialog from the DOM. Foldkit's dialog handles that unmount by closing itself; opening the form again initializes blank fields. A failed refresh becomes `Stale(true)`, which the current helper also rejects, and the admin update's failure branch additionally resets the Sources model.

## Access contract

Keep `AdminAccess` as the existing `AsyncData<boolean, PermissionError>`; its data-bearing states already retain the last confirmed result. Centralize the decision in `canAccessAdmin`, and use it consistently for the admin view, navigation/header, section entry, Sources actions, and form submission.

| Access state                                                 | Admin usable? | Behavior                                                                              |
| ------------------------------------------------------------ | ------------- | ------------------------------------------------------------------------------------- |
| `Idle`, `Loading`                                            | No            | No earlier grant; show the existing checking state.                                   |
| `Failure`                                                    | No            | Initial check failed; show its error and Retry.                                       |
| `Success(true)`                                              | Yes           | Confirmed grant.                                                                      |
| `Refreshing(true)`                                           | Yes           | Keep the mounted page, dialog, draft, and actions while checking again.               |
| `Stale(true, error)`                                         | Yes           | Retain the grant after a transient check failure; show a nonblocking error and Retry. |
| `Success(false)`, `Refreshing(false)`, `Stale(false, error)` | No            | Never infer a grant from a stored `false`.                                            |

The latter two `false` states are defensive cases even if normal navigation redirects immediately after `Success(false)`. Use an explicit match over the AsyncData variants or equivalent logic so the prior value is examined only in states that actually contain data. Do not add a second access boolean or treat the mere presence of a session as admin authorization.

This policy intentionally allows the UI to remain usable after a transient permission-check failure. It does not grant database rights: the Sources service continues to use the user's Supabase session and the existing source RLS policies. If the server has revoked a user's rights but the check cannot be reached, the UI can remain visible temporarily while protected reads and writes are still governed by server authorization. A successful `false` result is the authoritative revocation signal for the admin UI.

## Implementation plan

1. **Change the shared access predicate.** Update `src/domain/admin-access.ts` so `canAccessAdmin` returns the retained boolean for `Success`, `Refreshing`, and `Stale`, and `false` for states without data. Keep all existing call sites on this one predicate. The root's Admin link and header, `src/page/admin/view.ts`, `src/page/admin/update.ts`, and the Sources child will then agree about whether access is usable.

2. **Preserve the Sources model on a failed check.** In `src/page/admin/update.ts`, retain the current `userId`/`adminRequestId`/pending-state guards on `SettledFetchAccess`. On `Result.fail`, settle the access state but do not call `enterSourcesTable` with `isAllowed: false`; that call currently recreates the Sources model, including the form. A prior `true` becomes `Stale(true, error)` and keeps its child state. An initial failure becomes `Failure(error)` and stays gated. Keep the `Result.succeed(true)` path that enters Sources when appropriate. Keep `Result.succeed(false)` as the sole permission-result path that resets Sources and emits `DeniedAccess` for the root redirect.

3. **Keep the admin subtree mounted during a refresh.** With `Refreshing(true)` accepted by the shared predicate, `src/page/admin/view.ts` should continue rendering the same admin subtree. It must not swap to the checking view during revalidation. The native dialog stays mounted and open, and the form fields remain in the model. The Sources child may continue accepting its in-flight completions and user actions during this period; no new pause, cancellation, or replay mechanism is needed.

4. **Retain session and response boundaries.** `AuthStateChanged(None)` still signs out immediately. A different `userId` still constructs a new logged-in model with `AdminAccess.Idle()`; the old user's grant and form must not carry over. A current `Success(false)` still clears Sources and redirects, including when it arrives while the dialog is open. Ignore late results whose request ID or user ID does not match; an older `false` response must not revoke a newer confirmed grant. Keep server-side RLS and the `has_admin_access` RPC unchanged.

## Verification plan

- Add domain tests for every row in the access table, especially `Refreshing(true)`, `Stale(true)`, and all `false` values.
- Update admin Story tests: a failed refresh from `Success(true)` yields `Stale(true)` while preserving the Sources scope, filters, form draft, and `dialog.isOpen`; a first-load failure remains gated; a current `Success(false)` resets Sources and emits `DeniedAccess`; a stale or wrong-user `false` result is ignored. Remove the existing assertion that `Stale(true)` denies access.
- Update root Scene tests that currently expect the Admin content to disappear for `Refreshing(true)`. Assert the page, Sources form, and an open populated dialog remain present through revalidation and a failed check. Check that retry does not close it, while an explicit `false` or sign-out removes it. Verify the failed-refresh status is announced and has an accessible Retry control.
- Exercise a browser flow: open and fill “Create source”, switch browser tabs long enough for an auth state event/revalidation, and return while the check is pending, after `true`, and after a network failure. The dialog and values should stay. Then confirm an explicit denial redirects and a new user never sees the previous draft.
- Run focused app tests, then the repository gates `pnpm fmt`, `pnpm lint`, and `pnpm typecheck` when implementing. This document is a plan; it does not change runtime behavior.

## References

- [Current access predicate](../src/domain/admin-access.ts)
- [Admin update and request guards](../src/page/admin/update.ts)
- [Root auth state handling](../src/main.ts)
- [Sources entry behavior](../src/page/admin/sources/update.ts)
- [Create-source form behavior](../src/page/admin/sources/form/update.ts)
- [Foldkit dialog unmount handling](../../../repos/foldkit/packages/ui/src/dialog/index.ts)
- [Supabase auth state events](https://supabase.com/docs/reference/javascript/auth-onauthstatechange)
