import { Array, Match, Option } from "effect";
import { Disclosure, Listbox } from "@foldkit/ui";
import type { Attribute, Html, HtmlBuilder } from "foldkit/html";
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
import { FieldValidation } from "foldkit";
import { cn } from "cn";

const buttonClass = (isPrimary: boolean) =>
  cn(
    "cursor-pointer",
    "px-2 py-1",
    "bg-slate-100 hover:bg-slate-200",
    isPrimary && "bg-slate-200 hover:bg-slate-300",
    "text-sm text-slate-800",
    "dark:bg-slate-700 dark:hover:bg-slate-600 dark:text-slate-200",
    isPrimary && "dark:bg-slate-600 dark:hover:bg-slate-500",
  );
const fieldLabelClass = "flex flex-col gap-1 text-sm";
const controlClass = `${Form.inputClass} min-w-36 text-left cursor-pointer`;
const panelClass = cn(
  "z-50 min-w-36",
  "border border-slate-100 shadow-xs bg-white",
  "dark:border-slate-700 dark:bg-slate-800",
);
const panelAnchor = { placement: "bottom-start" as const, gap: 8, padding: 0 };

const alert = (error: Option.Option<string>, h: HtmlBuilder<Message>) =>
  h.p([h.Role("alert"), h.Class("text-sm text-red-800")], [Option.getOrElse(error, () => "")]);

const itemConfig = (
  config: {
    label: string;
    isSelected: boolean;
    isActive: boolean;
  },
  h: HtmlBuilder<Message>,
) => ({
  className: cn(
    "cursor-pointer",
    "px-3 py-2",
    "text-sm font-light",
    config.isActive && "bg-slate-100",
    "dark:text-slate-200",
    config.isActive && "dark:bg-slate-700",
  ),
  content: h.span(
    [h.Class("inline-flex items-center gap-2")],
    [config.label, config.isSelected ? h.span([h.InnerHTML("&check;")]) : h.empty],
  ),
});

const searchInput = (model: Model, h: HtmlBuilder<Message>) =>
  h.label(
    [h.Class(fieldLabelClass)],
    [
      "Search",
      h.input([
        h.AriaLabel("Search names"),
        h.Type("search"),
        h.Value(model.draftFilters.searchText.value),
        h.OnInput((value) => Message.UpdatedSearch({ value })),
        h.OnKeyDownPreventDefault((key) =>
          key === "Enter" ? Option.some(Message.PressedEnter()) : Option.none(),
        ),
        h.AriaInvalid(model.draftFilters.searchText._tag === "Invalid"),
        h.Class(Form.inputClass),
      ]),
      FieldValidation.match(model.draftFilters.searchText, {
        onNotValidated: () => alert(Option.none(), h),
        onValidating: () => alert(Option.none(), h),
        onValid: () => alert(Option.none(), h),
        onInvalid: ({ errors }) => alert(Array.head(errors), h),
      }),
    ],
  );

const enabledInput = (model: Model, h: HtmlBuilder<Message>) => {
  const items = ["all", "true", "false"] as const;

  const encodeValue = (value: Option.Option<boolean>): (typeof items)[number] =>
    Option.match(value, {
      onNone: () => "all",
      onSome: (value) => (value ? "true" : "false"),
    });
  const valueToButtonContent = (value: Option.Option<boolean>) => {
    const text = Option.match(value, {
      onNone: () => "All",
      onSome: (value) => (value ? "Enabled" : "Disabled"),
    });
    return h.span([], [text]);
  };

  const encodedValueToDisplay = (encodedValue: (typeof items)[number]) =>
    Match.value(encodedValue).pipe(
      Match.when("all", () => "All"),
      Match.when("true", () => "Enabled"),
      Match.when("false", () => "Disabled"),
      Match.exhaustive,
    );

  return h.div(
    [h.Class(fieldLabelClass)],
    [
      h.label([h.For(Listbox.buttonId(EnabledFilterListboxId))], ["Enabled"]),
      h.submodel({
        slotId: EnabledFilterListboxId,
        model: model.enabledListbox,
        view: EnabledFilterListbox.view,
        viewInputs: {
          items,
          maybeSelectedValue: Option.some(encodeValue(model.draftFilters.enabled)),
          buttonContent: valueToButtonContent(model.draftFilters.enabled),
          buttonClassName: controlClass,
          itemsClassName: panelClass,
          anchor: panelAnchor,
          itemToConfig: (item, { isActive, isSelected }) =>
            itemConfig(
              {
                label: encodedValueToDisplay(item),
                isSelected,
                isActive,
              },
              h,
            ),
        },
        toParentMessage: (message) => Message.GotEnabledListboxMessage({ message }),
      }),
    ],
  );
};

const typeInput = (model: Model, h: HtmlBuilder<Message>) => {
  const items = ["all", "web_scrape"] as const;

  const encodeValue = (
    value: Option.Option<Exclude<(typeof items)[number], "all">>,
  ): (typeof items)[number] =>
    Option.match(value, {
      onNone: () => "all",
      onSome: () => "web_scrape",
    });
  const valueToButtonContent = (value: Option.Option<Exclude<(typeof items)[number], "all">>) => {
    const text = Option.match(value, {
      onNone: () => "All types",
      onSome: (inner) =>
        Match.value(inner).pipe(
          Match.when("web_scrape", () => "Web scrape"),
          Match.exhaustive,
        ),
    });

    return h.span([], [text]);
  };

  const encodedValueToDisplay = (encodedValue: (typeof items)[number]) =>
    Match.value(encodedValue).pipe(
      Match.when("all", () => "All types"),
      Match.when("web_scrape", () => "Web scrape"),
      Match.exhaustive,
    );

  return h.div(
    [h.Class(fieldLabelClass)],
    [
      h.label([h.For(Listbox.buttonId(TypeFilterListboxId))], ["Type"]),
      h.submodel({
        slotId: TypeFilterListboxId,
        model: model.typeListbox,
        view: TypeFilterListbox.view,
        viewInputs: {
          items,
          maybeSelectedValue: Option.some(encodeValue(model.draftFilters.type)),
          buttonContent: valueToButtonContent(model.draftFilters.type),
          buttonClassName: controlClass,
          itemsClassName: panelClass,
          anchor: panelAnchor,
          itemToConfig: (item, { isActive, isSelected }) =>
            itemConfig(
              {
                label: encodedValueToDisplay(item),
                isSelected,
                isActive,
              },
              h,
            ),
        },
        toParentMessage: (message) => Message.GotTypeListboxMessage({ message }),
      }),
    ],
  );
};

const fetchStatusInput = (model: Model, h: HtmlBuilder<Message>) => {
  const items = ["all", "never", "fetched"] as const;

  const encodeValue = (
    value: Option.Option<Exclude<(typeof items)[number], "all">>,
  ): (typeof items)[number] =>
    Option.match(value, {
      onNone: () => "all",
      onSome: (inner) => inner,
    });
  const valueToButtonContent = (value: Option.Option<Exclude<(typeof items)[number], "all">>) => {
    const text = Option.match(value, {
      onNone: () => "All",
      onSome: (inner) =>
        Match.value(inner).pipe(
          Match.when("never", () => "Never fetched"),
          Match.when("fetched", () => "Fetched"),
          Match.exhaustive,
        ),
    });

    return h.span([], [text]);
  };

  const encodedValueToDisplay = (encodedValue: (typeof items)[number]) =>
    Match.value(encodedValue).pipe(
      Match.when("all", () => "All"),
      Match.when("never", () => "Never fetched"),
      Match.when("fetched", () => "Fetched"),
      Match.exhaustive,
    );

  return h.div(
    [h.Class(fieldLabelClass)],
    [
      h.label([h.For(Listbox.buttonId(FetchStatusFilterListboxId))], ["Fetch status"]),
      h.submodel({
        slotId: FetchStatusFilterListboxId,
        model: model.fetchStatusListbox,
        view: FetchStatusFilterListbox.view,
        viewInputs: {
          items,
          maybeSelectedValue: Option.some(encodeValue(model.draftFilters.fetchStatus)),
          buttonContent: valueToButtonContent(model.draftFilters.fetchStatus),
          buttonClassName: controlClass,
          itemsClassName: panelClass,
          anchor: panelAnchor,
          itemToConfig: (item, { isActive, isSelected }) =>
            itemConfig(
              {
                label: encodedValueToDisplay(item),
                isSelected,
                isActive,
              },
              h,
            ),
        },
        toParentMessage: (message) => Message.GotFetchStatusListboxMessage({ message }),
      }),
    ],
  );
};

const filterButtons = (_model: Model, h: HtmlBuilder<Message>) => [
  h.button([h.OnClick(Message.ClickedApply()), h.Class(buttonClass(true))], ["Apply"]),
  h.button([h.OnClick(Message.ClickedClear()), h.Class(buttonClass(false))], ["Clear"]),
  h.button(
    [h.OnClick(Message.ClickedRefresh()), h.AriaLabel("Refresh"), h.Class(buttonClass(false))],
    [h.span([h.AriaHidden(true), h.InnerHTML("&#8635;")])],
  ),
];

const narrowControlsButton = (
  model: Model,
  attributes: ReadonlyArray<Attribute<Message>>,
  h: HtmlBuilder<Message>,
) =>
  h.button(
    [
      ...attributes,
      h.Class(
        cn(
          "w-full",
          "border-t border-b border-slate-200 dark:border-slate-700",
          "px-2 py-2",
          "flex items-center justify-between gap-2",
          "text-sm text-slate-800 dark:text-slate-200",
        ),
      ),
    ],
    [
      "Filters",
      h.span([
        h.AriaHidden(true),
        h.InnerHTML("&rsaquo;"),
        h.Class(cn("transition", model.isMobileFiltersOpen ? "rotate-90" : "rotate-0")),
      ]),
    ],
  );

export const narrowControls = (model: Model, h: HtmlBuilder<Message>): Html => {
  return Disclosure.view(
    {
      id: "admin-sources-mobile-filters",
      isOpen: model.isMobileFiltersOpen,
      onToggle: (isOpen) => Message.ToggledMobileFilters({ isOpen }),
      toView: ({ button, panel, animatePanel }) =>
        h.div(
          [],
          [
            narrowControlsButton(model, button, h),
            animatePanel(
              h.section(
                [...panel, h.Class("bg-slate-50 dark:bg-slate-800 p-4 flex flex-col gap-10")],
                [
                  h.div(
                    [h.Class("flex flex-col gap-6")],
                    [
                      searchInput(model, h),
                      enabledInput(model, h),
                      typeInput(model, h),
                      fetchStatusInput(model, h),
                    ],
                  ),
                  h.div([h.Class("flex flex-wrap items-start gap-3")], filterButtons(model, h)),
                ],
              ),
            ),
          ],
        ),
    },
    h,
  );
};

export const wideControls = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.section(
    [h.AriaLabel("Filters"), h.Class("flex flex-wrap items-center gap-x-6 gap-y-3")],
    [
      h.div(
        [h.Class("flex flex-wrap items-start gap-3")],
        [
          searchInput(model, h),
          enabledInput(model, h),
          typeInput(model, h),
          fetchStatusInput(model, h),
        ],
      ),
      h.div([h.Class("flex flex-wrap items-start gap-3")], filterButtons(model, h)),
    ],
  );

export * as AdminSourcesFilter from "./filter";
