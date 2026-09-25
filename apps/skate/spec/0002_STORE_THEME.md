# Persist the user's theme preference

## Decision

Use Effect's `KeyValueStore` with `BrowserKeyValueStore.layerLocalStorage`, provided at the startup read and save-command boundaries. Keep the underlying read/write Effects unprovided so tests can supply `KeyValueStore.layerMemory` or a failing implementation.

Do not add an application resource for this change. Foldkit's resource documentation explicitly recommends per-command provisioning for `KeyValueStore`: storage identity can differ by operation (local versus session storage), and the browser adapter does not need a shared lifetime. Testing requires an injectable Effect boundary, not necessarily a runtime resource. Pure Story and Scene tests intercept Commands rather than executing storage, so they do not need a resource either.

If preferences later grow into a shared domain service, introduce a dedicated `ThemePreferences.Service` through application `resources`, with its browser layer internally providing `KeyValueStore`. That would allow command-level substitution without binding every storage operation to the same global store tag. A `ManagedResource` is inappropriate here: there is no model-dependent acquisition, release, or external handle to manage.

## Current behavior

- `src/domain/theme.ts` holds `userTheme: Option<Theme_>` and `systemTheme`. Boot always starts with `Option.none()`.
- `SelectedTheme` updates the model and issues `ResolveTheme`. `None` means follow the system; an explicit preference overrides it.
- `src/main.ts` gathers browser information in effectful flags and calls `Theme.boot` from pure init. This is the natural place to restore the preference before creating the initial model.
- `src/entry.ts` already supplies an Auth resource; theme persistence need not change that wiring.
- `Theme.subscriptions` defines system-theme changes, but the root currently does not compose it. Include that composition so choosing System continues responding to OS changes while the app is open.

## Storage contract

Use one namespaced key, `skate.userTheme`, storing the raw string `light` or `dark`. Decode reads with the existing `Theme_` schema; do not serialize Effect's `Option` representation. An absent key means `Option.none()`. Selecting System removes this key rather than saving the currently resolved system theme.

Missing, invalid, or inaccessible storage falls back to `None` at startup. Do not rewrite storage during boot or delete malformed data as a side effect of reading. A later explicit selection can overwrite or remove it. Storage is origin-local and independent of authentication; signing out should preserve the preference.

## Implementation

1. **Add small, injectable persistence Effects in `src/domain/theme.ts`.** Keep the key and codecs beside the theme domain, with named `Effect.fn` operations such as `loadUserTheme` and `saveUserTheme`. Both require `KeyValueStore.KeyValueStore` from `effect/unstable/persistence`. The installed Effect API returns `string | undefined` from `store.get`; convert absence to `Option` explicitly. Decode present strings with `Schema.decodeUnknownEffect(Theme_)`. Saving `Some` calls `store.set`; saving `None` calls `store.remove`. Leave typed storage/decoding errors available to callers and tests.

2. **Restore through flags.** Add `maybeUserTheme: Schema.Option(Theme.Theme_)` to `Flags`. Run the load Effect with `BrowserKeyValueStore.layerLocalStorage` inside `flags`, recovering expected read/decode errors to `Option.none()`. Extend `Theme.boot` to accept the restored preference and pass it from init. Boot uses that value in its model and initial `ResolveTheme` command, without saving it. Resolving flags before init avoids a late load overwriting a user's new selection. This establishes the correct first application model; eliminating every pre-runtime CSS flash is a separate concern.

3. **Save on explicit selection.** Add `SaveUserTheme`, with a schema-typed optional-theme argument, alongside the existing theme Commands. Its execute Effect calls the injectable save operation and provides the browser storage layer locally. Emit `CompletedSaveUserTheme` on success and `FailedSaveUserTheme` on expected failure, handling both in the theme update without changing the selected preference. Update `SelectedTheme` to issue both `ResolveTheme` and `SaveUserTheme`. Keep immediate UI changes independent of storage success. System-theme changes and save-result messages must not trigger saves, retries, or rollbacks.

4. **Keep side effects in Effects.** Move `ResolveTheme`'s DOM mutation into an explicit `Effect.sync`/generator body while touching this code. Use the Foldkit command/result naming conventions. Handle persistence failures at the flags/command boundary so unavailable storage does not prevent app startup or interaction. No storage access belongs in update, view, or pure boot.

5. **Compose the existing theme subscription.** Use Foldkit's subscription lifting/aggregation APIs to forward theme subscription messages through `Message.GotThemeMessage`, alongside the existing media-width and auth subscriptions. Keep the selected preference authoritative when system theme changes.

6. **Update affected fixtures.** Add the new flag to init fixtures and expected command lists to theme-selection tests. Preserve existing main-menu closing behavior and child-message mapping. Do not introduce a generic storage framework or an additional copy of the selected theme outside the Model.

Foldkit runs Commands concurrently, so the array order is not a sequencing guarantee. The save Effect should contain only the synchronous local-storage write/removal, with no asynchronous preparation, delay, or retry. Verify rapid successive selections leave the latest preference persisted. If storage later becomes asynchronous, explicitly serialize writes; cancellation alone cannot undo an already committed write.

## Verification

- **Persistence Effect tests:** provide one fresh `KeyValueStore.layerMemory` around each complete seed/action/assert sequence. Cover missing keys, both valid themes, invalid strings, write/read round trips, removing the key for System, and preservation of unrelated keys. Separate provisions around seed and read would accidentally create separate stores.
- **Failure tests:** supply a failing `KeyValueStore` implementation to verify typed errors and boundary recovery. Exercise denied reads, writes, and removals. Verify boot falls back and save failure leaves the chosen theme active. Use the project's existing Vitest/Effect conventions; no new test dependency is required.
- **Story tests:** restored boot state produces the matching `ResolveTheme` and no save; explicit selections emit the resolve/save pair; completion/failure messages do not change the model or create save loops; system changes never persist a preference.
- **Scene tests:** retain menu-selection coverage for Light, Dark, and System, including menu closure and parent command mapping. These tests assert command intent and do not establish that browser storage was written.
- **Browser integration/manual checks:** select each option and reload; verify the menu and document theme agree. Test System with an OS theme change, explicit overrides across OS changes, rapid successive selections, and blocked storage. Check subscription lifting actually receives browser events.
- For implementation, run `pnpm fmt`, `pnpm lint`, `pnpm typecheck`, and `pnpm test:app`. This document itself is a plan, not an implementation.

## Local references

- [Foldkit resource guidance](../../../repos/foldkit/packages/website/src/page/core/resources.md): per-command storage provision, runtime lifetimes, and the testability tradeoff.
- [Foldkit website theme implementation](../../../repos/foldkit/packages/website/src/main.ts): effectful startup restoration and `SaveThemePreference` with local browser provision. Its JSON format is precedent for schema validation, not a format Skate needs to copy.
- [Kanban save command](../../../repos/foldkit/examples/kanban/src/command.ts): `KeyValueStore` and a locally provided browser layer.
- [Foldkit conventions](../FOLDKIT.md): pure init/update, Commands, messages, and Story/Scene testing.
- Installed `apps/skate/node_modules/@effect/platform-browser/src/BrowserKeyValueStore.ts` and `apps/skate/node_modules/effect/src/unstable/persistence/KeyValueStore.ts`: confirmed browser layer, nullable read result, memory layer, and typed errors against the installed packages.

The vendored sources live under repository-root `repos/` and remain read-only. Application imports must use package dependencies.
