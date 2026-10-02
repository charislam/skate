# Persist the calendar view preference

## Proposed behavior

Save explicit Day/Week/Month selections from the main menu using the same Effect `KeyValueStore` and browser local-storage boundaries as [theme persistence](../src/domain/theme.ts).

**Confirmed behavior:** mobile remains Day-only, as it is today. Tablet-and-above remembers its selected Day/Week/Month view independently of that mobile fallback. Returning to tablet-and-above restores that preference.

Use the existing `(min-width: 1024px)` breakpoint, including exactly 1024px in tablet-and-above. “Mobile” here means below that breakpoint, not device detection.

| Situation                                 | Displayed view                       | Persistence                              |
| ----------------------------------------- | ------------------------------------ | ---------------------------------------- |
| First visit, either width                 | Day                                  | No write                                 |
| Reload at tablet-and-above                | Saved view, or Day if absent/invalid | Read only                                |
| Reload on mobile                          | Day                                  | Retain saved tablet-and-above preference |
| Select Day/Week/Month at tablet-and-above | Selected view immediately            | Save explicit selection                  |
| Shrink to mobile                          | Day                                  | No write                                 |
| Expand to tablet-and-above                | Saved in-memory preference, or Day   | No write                                 |
| Save fails                                | Keep selection for this running app  | No rollback or retry                     |

For example, selecting Month, shrinking to mobile, reloading, and expanding must restore Month. Explicitly selecting Day on a wide screen replaces Month. No mobile preference needs storing while Day is the only supported choice.

Persist only granularity, not dates, dialog state, or calendar cache. Ordinary startup still anchors to today in Toronto. Width changes use existing date-range conversion semantics (Day's date or Week/Month's start date), without resetting to today. Session-detail navigation continues anchoring the displayed range to the session date and must never modify the saved view preference.

Preferences remain origin-local and independent of authentication, like theme. No account synchronization, cross-tab live synchronization, reset control, or breakpoint change is included.

## Current implementation

- `src/domain/main-menu.ts` defines Day/Week/Month actions; `src/page/calendar/view.ts` hides Week and Month below 1024px and derives the pressed button from `activeDateRange`.
- `src/page/calendar/update.ts` handles explicit `SelectedMainMenuAction` separately from low-level date-range messages and emits an out-message to close the menu. This is the persistence trigger.
- Calendar boot starts at `ActiveDate.Initial` and issues `SyncInitialDate`. Its result currently transitions to Day. Restoring a preference must account for that result instead of allowing it to overwrite the restored view.
- `MediaWidthChanged` currently forces Day on shrink and does nothing on expansion. Its Session-route branch may anchor Day to a loaded session's date.
- Session-detail results use `moveCalendarRange` to anchor the current granularity to the session date. The calendar model survives route/auth transitions through the root's common state.

## Storage and state contract

Introduce `src/page/calendar/view-preference.ts` with a schema for `Day | Week | Month`, a pure width-aware resolver, and injectable `loadUserCalendarView` / `saveUserCalendarView` Effects. Keep persistence and resolution owned by Calendar. Reuse the existing main-menu action literals for schema validation rather than maintaining duplicate literal lists or making the main-menu domain depend on page internals.

Use `skate.userCalendarView.tabletOrAbove`, storing the raw string `Day`, `Week`, or `Month`. Keep it independent of `skate.userTheme`. Use `Option<CalendarView>` for an absent preference in flags and the calendar model; `None` resolves to Day. Save explicit Day as `Day`, rather than treating it as absence. No removal operation is needed without a reset UI.

Convert the store's `string | undefined` to `Option` at the read boundary. Schema-decode present values. Missing, malformed, or inaccessible storage falls back to `None` at startup, without rewriting or deleting anything. Leave expected errors available in the underlying Effects and recover at the startup/command boundaries.

Keep `maybeUserTabletView` in the calendar model as the user's intent and `activeDateRange` as the effective displayed range. They serve different purposes: mobile can display Day while the preference remains Month. Root `tabletOrAbove` remains the source of width context; do not add another independent width subscription or storage service.

The root model does not store a second preference field, and siblings do not receive the preference. Root flags are only the startup transport into Calendar, not ongoing ownership. The root may call Calendar's load Effect when gathering flags and pass its result through boot; all selection, save, failure, and resolution behavior remains inside Calendar. Existing root message lifting and the menu-close out-message are sufficient.

## Implementation steps

1. **Restore before initialization.** Extend root `Flags` and its fixtures with the optional preference. Load with `BrowserKeyValueStore.layerLocalStorage`, recovering read/decode failures to `Option.none()`, just as theme does. Pass the preference and initial `tabletOrAbove` into `CalendarPage.boot` with today and page visibility. Retain the preference only in the Calendar model, without saving.

2. **Resolve the initial range synchronously in boot.** `SyncInitialDate` only echoes the already-known `today`; it does not acquire any missing information. Remove that command from the runtime startup path. Calendar boot must return a concrete Day/Week/Month range anchored to today and one `PrepareCalendarDates` command for that resolved range. Use pure ActiveDate initialization/transitions to resolve the range before returning the model, without issuing commands for intermediate states. If the machine API requires `Initial`, retain it only as a transient internal seed consumed synchronously by a pure initialization helper. `SyncedInitialDate` can remain an internal machine transition for that helper, but must no longer be an externally dispatched Calendar message. Update message composition and fixtures accordingly. Boot's command return type must include any resource requirements of `PrepareCalendarDates`. The root continues mapping Calendar boot commands as it does today.

3. **Save only explicit supported menu selections.** On `SelectedMainMenuAction` at tablet-and-above, update the optional preference immediately, perform the existing date-range transition/cache preparation, and emit `SaveUserCalendarView` plus the existing menu-close out-message. Define the command and completion/failure messages alongside calendar commands/messages; its execute Effect supplies the browser layer locally. Both result messages leave the model unchanged. Mobile actions must not change or save the tablet preference, including synthetic unsupported Week/Month messages. Internal `SelectedDayView`/`SelectedWeekView`/`SelectedMonthView` messages remain transition mechanisms without persistence effects.

4. **Restore on breakpoint changes.** Resolve Day below the breakpoint and the in-memory preference above it. Apply existing range conversion rules only when the effective granularity changes; repeated width messages should not cause redundant loads. Preserve the existing session-date anchoring when details are loaded, and ensure the resulting displayed dates go through cache preparation. Do not save on resize. This must work while other routes are open as well as on Home, since the calendar model is retained.

5. **Preserve navigation behavior.** Keep the selected menu button tied to the effective range. Verify session-detail loading, returning Home, authentication transitions, date paging, and Go to today retain the preference without writing it. A detail response changes the date anchor using the current effective granularity, never a stale width or saved preference captured when a request started. Reuse existing cache/request protections.

6. **Update fixtures and command expectations.** Cover root initialization, calendar boot, persistence result messages, and menu-close command mapping. Keep all storage access out of pure boot/update/view. Use named options objects for related inputs and follow repository `Option` conventions. Read `FOLDKIT.md` before implementation and consult installed/vendored APIs as needed; no dependency or application resource is required.

As with theme, Foldkit command arrays do not imply execution order. Keep the local-storage write free of asynchronous preparation or retries, and verify rapid selections persist the latest choice. If runtime scheduling cannot guarantee that behavior, serialize saves explicitly rather than assuming command array order.

## Initialization and message ordering

The invariant is that every Calendar model exposed to the runtime already has a concrete date range. No user messages are processed during flag loading or pure boot, so there is no runtime Initial phase requiring queued selections, ignored navigation, or delayed resize resolution. Make that invariant explicit in the Calendar model's range type if the machine integration permits it; otherwise centralize construction and test that every boot path establishes it.

| Ordering                                                  | Required behavior                                                                                                         |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Missing, invalid, or failed preference read               | Flags finish with `None`; boot returns Day at either width.                                                               |
| First menu selection before initial calendar data returns | Apply and save immediately using current width; data loading does not block selection.                                    |
| First resize before initial calendar data returns         | Resolve from the current preference and new width immediately, without saving.                                            |
| Resize then menu action                                   | Root updates width before forwarding the action; a mobile action cannot overwrite the tablet preference.                  |
| Menu action then resize                                   | Save the wide-screen selection, then display Day on mobile while retaining that selection.                                |
| Date paging or Go to today before initial data returns    | Operate on the concrete boot range normally; no ignored input due to Initial.                                             |
| Session detail arrives before or after boot-range data    | A still-relevant detail result anchors the current effective view to the session date; it never changes the preference.   |
| Boot-range preparation/data completes after a view change | Existing cache/request handling may populate the old range's cache, but must not restore its range, width, or preference. |

## Verification

- **Persistence Effects:** with one fresh memory-store provision per test sequence, cover absence, each valid value, invalid values, round trips, and preservation of the theme/unrelated keys. Inject read/write failures and verify recovery at the relevant boundary.
- **Boot and transitions:** cover both widths with every saved value and no preference; every boot returns a concrete range; no startup save or `SyncInitialDate`; exactly the resolved range is initially prepared; and an invalid value falls back to Day. Exercise each ordering in the initialization table, including interaction before the first data result and both orders of resize/menu selection.
- **Responsive regression:** Month → mobile Day → wide Month; Week → mobile reload → wide Week; explicit wide Day replacing a previous preference; repeated width notifications; resize while a non-calendar route is active; and no mobile overwrite.
- **Interaction/failure:** menu closes and its pressed state matches the displayed view; save failure preserves the new in-memory choice across resize; internal transitions/date navigation/detail responses never save; session details anchor to the correct date across resize and response ordering.
- During implementation run `pnpm fmt`, `pnpm lint`, `pnpm typecheck`, and `pnpm test:app`. This change delivers the plan only.
