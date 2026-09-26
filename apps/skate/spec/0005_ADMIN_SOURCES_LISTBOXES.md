# Admin source listboxes

## Scope and current state

Replace the native selects for the Enabled, Type, and Fetch status filters with Foldkit UI single-select Listboxes. These three controls currently live in `src/page/admin/sources/view/filter.ts`, which the staged changes extracted from `src/page/admin/sources/view.ts`. The path named in the request, `src/page/admin/sources/form/view.ts`, contains a separate, disabled Type select in the create-source dialog. Convert that field to a disabled Listbox as well, keeping its sole “Web scrape” value and its current inability to change source type.

This is a presentation and interaction change. Preserve the current filter choices, draft-versus-applied behavior, Apply and Clear filters actions, and source creation payload. Do not change the source schema, service, or query contract. Work with the staged filter extraction rather than moving its controls back into `sources/view.ts`.

## Selection contract

| Control             | Listbox items               | Selected value in the parent model            | On selection                           |
| ------------------- | --------------------------- | --------------------------------------------- | -------------------------------------- |
| Enabled filter      | All, Enabled, Disabled      | `Option<boolean>`; All is `None`              | Update `draftFilters.enabled` only     |
| Type filter         | All types, Web scrape       | `Option<SourceType>`; All types is `None`     | Update `draftFilters.type` only        |
| Fetch status filter | All, Never fetched, Fetched | `Option<"never" \| "fetched">`; All is `None` | Update `draftFilters.fetchStatus` only |
| Create-source Type  | Web scrape                  | Existing `form.type`, always `"web_scrape"`   | No user selection; Listbox is disabled |

Use typed string item values at the Listbox boundary, including an explicit `"all"` item for each filter. Convert them to the existing `Option` fields in the parent update, without storing `"all"` in the domain model or adding a second selection state. Keep `Listbox.create<Item>()` declarations at module scope so each view and update pair shares the same item type. Give all four Listboxes distinct, stable IDs and submodel slots.

## Implementation plan

1. **Add interaction models.** Add three `Listbox.Model` fields to the Sources model and initialize them in `sources/model.ts`. Add one to the create-source form model and initialize it in `sources/form/model.ts`. Keep the selected values in `draftFilters` and `form.type`; the Listbox models own only open state, active item, and keyboard interaction. A new Sources scope or reopened create dialog should initialize the relevant Listbox closed.

2. **Forward child messages.** Add one `Got...ListboxMessage` variant per control to the Sources and form message unions. In their updates, use `Update.foldChild` with the corresponding typed Listbox bundle. Write each next child model back, lift its commands into the parent message type, and fold `Listbox.OutMessage.Selected` into the existing filter field. The three filter selections must not apply a query or fetch a page until Apply is used. The disabled form Type Listbox needs the same message route for the component contract; retain `form.type` as `"web_scrape"` and do not add a selectable type-change path.

3. **Render the controls.** In `sources/view/filter.ts`, replace each `h.select` with `h.submodel` using the matching Listbox view. Pass the existing draft value as `maybeSelectedValue`, mapped to the Listbox item value (`"all"` for `None`); supply the same visible labels, display text, and option order. Use separate `<label for={Listbox.buttonId(id)}>` elements so each trigger has its field name. Style triggers to align with the search input and give the floating items panel a readable border, selected and active states, a width matching its trigger, and a suitable z-index. Keep the existing search and action buttons in place. Remove the now unused `optionValue` helper from `sources/view.ts` and from the filter view if the new mapping supersedes it.

4. **Convert the dialog Type field.** In `sources/form/view.ts`, replace its disabled `h.select` with the form Type Listbox submodel. Pass `Option.some(model.type)`, the one “Web scrape” item, and `isDisabled: true`. Associate the Type label with the Listbox button. Match the surrounding form field styling and preserve the unavailable state. Since the Listbox is disabled, it should never open inside the dialog or submit a different value; submission continues to read `model.type`.

5. **Keep reset behavior coherent.** `ClickedClear` should continue setting all draft filters to `None` and applying that cleared query; each Listbox then displays its All item from the parent-owned value. Preserve open/close behavior when the Sources model is reset or the dialog closes. Avoid reinitializing Listbox models on every render, which would lose focus and keyboard state.

## Verification when implementing

- Check each filter by pointer and keyboard: open, move, typeahead, select, Escape, and focus return. Confirm the visible value and `aria-selected` follow the draft model, including All.
- Confirm selection alone does not refetch; Apply uses the selected combination; Clear filters restores All and refetches; existing sort and pagination behavior remains tied to the applied query.
- Check the disabled dialog Type trigger is labeled, unavailable, and displays Web scrape; creating a source still submits `web_scrape`. Check dropdown placement, width, stacking, and focus in the admin page.
- Add focused Story or Scene coverage for the changed message flow and rendered controls, then run the relevant app checks and repository gates (`pnpm fmt`, `pnpm lint`, `pnpm typecheck`).

## References

- [Current filter view](../src/page/admin/sources/view/filter.ts)
- [Sources model](../src/page/admin/sources/model.ts)
- [Sources update](../src/page/admin/sources/update.ts)
- [Create-source form](../src/page/admin/sources/form/view.ts)
- [Foldkit Listbox implementation](../../../repos/foldkit/packages/ui/src/listbox/single.ts)
- [Foldkit Listbox example](../../../repos/foldkit/packages/website/src/snippet/uiListboxBasic.ts)
