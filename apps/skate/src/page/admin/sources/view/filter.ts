import { Option } from "effect";
import { Listbox } from "@foldkit/ui";
import type { Html, HtmlBuilder } from "foldkit/html";
import { Message } from "../message";
import type { Model } from "../model";
import { Form } from "~/view/form";
import {
  EnabledFilterListbox,
  EnabledFilterListboxId,
  FetchStatusFilterListbox,
  FetchStatusFilterListboxId,
  TypeFilterListbox,
  TypeFilterListboxId,
} from "../listboxes";

const controlClass = `${Form.inputClass} min-w-36 text-left`;
const panelClass = "z-50 min-w-full rounded border border-slate-300 bg-white py-1 shadow-lg";
const itemConfig = (
  h: HtmlBuilder<Message>,
  label: string,
  isActive: boolean,
  isSelected: boolean,
) => ({
  className: `cursor-pointer px-3 py-2 ${isActive ? "bg-slate-100" : ""} ${isSelected ? "font-semibold" : ""}`,
  content: h.span([], [label]),
});

export const wideControls = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class("flex flex-wrap items-end gap-3")],
    [
      h.label(
        [h.Class("flex flex-col gap-1 text-sm")],
        [
          "Search names",
          h.input([
            h.Type("search"),
            h.Value(model.draftFilters.searchText.value),
            h.OnInput((value) => Message.UpdatedSearch({ value })),
            h.OnKeyDownPreventDefault((key) =>
              key === "Enter" ? Option.some(Message.PressedEnter()) : Option.none(),
            ),
            h.AriaInvalid(model.draftFilters.searchText._tag === "Invalid"),
            h.AriaLabel("Search names"),
            h.Class(Form.inputClass),
          ]),
        ],
      ),
      h.div(
        [h.Class("flex flex-col gap-1 text-sm")],
        [
          h.label([h.For(Listbox.buttonId(EnabledFilterListboxId))], ["Enabled"]),
          h.submodel({
            slotId: EnabledFilterListboxId,
            model: model.enabledListbox,
            view: EnabledFilterListbox.view,
            viewInputs: {
              items: ["all", "true", "false"],
              maybeSelectedValue: Option.match(model.draftFilters.enabled, {
                onNone: () => Option.some<"all" | "true" | "false">("all"),
                onSome: (value) => Option.some<"all" | "true" | "false">(value ? "true" : "false"),
              }),
              buttonContent: Option.match(model.draftFilters.enabled, {
                onNone: () => h.span([], ["All"]),
                onSome: (value) => h.span([], [value ? "Enabled" : "Disabled"]),
              }),
              buttonClassName: controlClass,
              itemsClassName: panelClass,
              anchor: { placement: "bottom-start", gap: 4, padding: 8 },
              itemToConfig: (item, { isActive, isSelected }) =>
                itemConfig(
                  h,
                  item === "all" ? "All" : item === "true" ? "Enabled" : "Disabled",
                  isActive,
                  isSelected,
                ),
            },
            toParentMessage: (message) => Message.GotEnabledListboxMessage({ message }),
          }),
        ],
      ),
      h.div(
        [h.Class("flex flex-col gap-1 text-sm")],
        [
          h.label([h.For(Listbox.buttonId(TypeFilterListboxId))], ["Type"]),
          h.submodel({
            slotId: TypeFilterListboxId,
            model: model.typeListbox,
            view: TypeFilterListbox.view,
            viewInputs: {
              items: ["all", "web_scrape"],
              maybeSelectedValue: Option.match(model.draftFilters.type, {
                onNone: () => Option.some<"all" | "web_scrape">("all"),
                onSome: () => Option.some("web_scrape" as const),
              }),
              buttonContent: h.span(
                [],
                [Option.isSome(model.draftFilters.type) ? "Web scrape" : "All types"],
              ),
              buttonClassName: controlClass,
              itemsClassName: panelClass,
              anchor: { placement: "bottom-start", gap: 4, padding: 8 },
              itemToConfig: (item, { isActive, isSelected }) =>
                itemConfig(h, item === "all" ? "All types" : "Web scrape", isActive, isSelected),
            },
            toParentMessage: (message) => Message.GotTypeListboxMessage({ message }),
          }),
        ],
      ),
      h.div(
        [h.Class("flex flex-col gap-1 text-sm")],
        [
          h.label([h.For(Listbox.buttonId(FetchStatusFilterListboxId))], ["Fetch status"]),
          h.submodel({
            slotId: FetchStatusFilterListboxId,
            model: model.fetchStatusListbox,
            view: FetchStatusFilterListbox.view,
            viewInputs: {
              items: ["all", "never", "fetched"],
              maybeSelectedValue: Option.match(model.draftFilters.fetchStatus, {
                onNone: () => Option.some<"all" | "never" | "fetched">("all"),
                onSome: (value) => Option.some(value),
              }),
              buttonContent: Option.match(model.draftFilters.fetchStatus, {
                onNone: () => h.span([], ["All"]),
                onSome: (value) => h.span([], [value === "never" ? "Never fetched" : "Fetched"]),
              }),
              buttonClassName: controlClass,
              itemsClassName: panelClass,
              anchor: { placement: "bottom-start", gap: 4, padding: 8 },
              itemToConfig: (item, { isActive, isSelected }) =>
                itemConfig(
                  h,
                  item === "all" ? "All" : item === "never" ? "Never fetched" : "Fetched",
                  isActive,
                  isSelected,
                ),
            },
            toParentMessage: (message) => Message.GotFetchStatusListboxMessage({ message }),
          }),
        ],
      ),
      h.button([h.OnClick(Message.ClickedApply()), h.Class("rounded border px-3 py-1")], ["Apply"]),
      h.button(
        [h.OnClick(Message.ClickedClear()), h.Class("rounded border px-3 py-1")],
        ["Clear filters"],
      ),
      h.button(
        [h.OnClick(Message.ClickedRefresh()), h.Class("rounded border px-3 py-1")],
        ["Refresh"],
      ),
    ],
  );

export * as AdminSourcesFilter from "./filter";
