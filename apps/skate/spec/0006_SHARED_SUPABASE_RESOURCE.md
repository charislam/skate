# Shared Supabase resource

## Diagnosis

The warning is caused by the app creating two Supabase clients for the same project in one browser context. `Auth.layerConfig` calls `createClient` in `src/domain/auth.ts`, while `Sources.layerConfig` calls it again in `src/domain/sources.ts`. `src/entry.ts` merges those two layers, so both constructors run when Foldkit acquires the application resources. Both read `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` and use the SDK's default auth storage key.

In the installed `@supabase/supabase-js@2.116.0`, each `createClient` constructs a Supabase auth client. Its default storage key is derived from the project URL as `sb-<project-ref>-auth-token`. The installed `@supabase/auth-js@2.116.0` warns when a second GoTrue client is constructed with that storage key in the same browser context. This matches the reported `GoTrueClient@sb-127-auth-token:1` message. The browser's `installHook.js` frame is where the console warning is displayed; the warning originates in the auth SDK.

## Resolution plan

1. Add `src/domain/supabase.ts` with one Effect service tag that exposes the configured `SupabaseClient`. Its `layerConfig` reads the existing URL and redacted publishable key through Effect `Config` and calls `createClient` once. Keep the current browser session persistence and storage-key defaults.
2. Change the Auth layer to obtain that client with `yield* Supabase.Service` and build its existing auth interface from it. Change the Sources layer to obtain the same dependency and build its existing source interface from it. Remove `createClient` and duplicate config reads from both domain services. Keep their public operations, error mapping, and auth event stream behavior intact.
3. In `src/entry.ts`, merge the Auth and Sources layers first, then provide the single Supabase layer to the merged graph, and provide the existing `AuthConfig.layer` to that graph. This gives both services the same client instance during one Foldkit resource acquisition. Keep `src/resource.ts` limited to the Auth and Sources services consumed by commands and subscriptions; Supabase remains their internal dependency.
4. Confirm the resulting layer graph contains one `createClient` call for the app and that both service layers receive the same instance. Check the auth subscription, session restoration, sign-in and sign-out, and source reads and creation. After a full browser reload, confirm the duplicate GoTrue warning is absent. If it only reappears during development hot reload, inspect that separate runtime lifecycle before changing auth storage behavior.

## Implementation notes

- Foldkit's resource provider builds the combined `resources` layer once per application runtime and shares the resulting services across commands and subscriptions. The shared Supabase layer should therefore be constructed inside that resource graph, rather than inside either operation or a module-level global.
- Effect memoizes layer acquisition within one graph. Provide the Supabase layer once to the merged Auth and Sources layer so sharing is explicit and cannot depend on two separately provided subgraphs happening to deduplicate.
- Do not create a second client with a different storage key merely to silence the warning: it would separate the source requests from the auth session used by the Auth service.

## References

- [Auth service](../src/domain/auth.ts)
- [Sources service](../src/domain/sources.ts)
- [Application resource wiring](../src/entry.ts)
- [Foldkit resource provider](../../../repos/foldkit/packages/foldkit/src/runtime/resourceProvider.ts)
- [Supabase client initialization](https://supabase.com/docs/reference/javascript/initializing)
