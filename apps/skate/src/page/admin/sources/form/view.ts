import { Dialog, Listbox } from "@foldkit/ui";
import { Option } from "effect";
import { FieldValidation, Submodel } from "foldkit";
import type { HtmlBuilder } from "foldkit/html";
import { Message } from "./message";
import type { Model } from "./model";
import { TypeListbox, TypeListboxId } from "./listbox";

const error = (field: FieldValidation.Field<string>, h: HtmlBuilder<Message>) =>
  field._tag === "Invalid"
    ? h.p([h.Role("alert"), h.Class("text-sm text-red-700")], [field.errors[0]])
    : h.empty;

export const view = Submodel.defineView<Model, Message>((model, h) => {
  return h.submodel({
    slotId: model.dialog.id,
    model: model.dialog,
    view: Dialog.view,
    toParentMessage: (message) => Message.GotDialogMessage({ message }),
    viewInputs: {
      hasDescription: true,
      toView: ({ dialog, backdrop, panel, title, description, closeButton, isVisible }) =>
        h.dialog(
          [
            ...dialog,
            h.Class(
              "fixed inset-0 m-auto bg-transparent p-0 open:flex items-center justify-center",
            ),
          ],
          isVisible
            ? [
                h.div([...backdrop, h.Class("fixed inset-0 bg-black/50")]),
                h.div(
                  [...panel, h.Class("relative w-full max-w-lg rounded-lg bg-white p-6 shadow-xl")],
                  [
                    h.h2([...title, h.Class("text-xl font-semibold")], ["Create source"]),
                    h.p(
                      [...description, h.Class("mt-2 text-sm text-gray-600")],
                      ["Add a web scrape source to collect from."],
                    ),
                    h.form(
                      [h.OnSubmit(Message.SubmittedForm()), h.Class("mt-4 flex flex-col gap-4")],
                      [
                        h.label(
                          [h.Class("flex flex-col gap-1")],
                          [
                            "Name",
                            h.input([
                              h.Type("text"),
                              h.Value(model.name.value),
                              h.AriaInvalid(model.name._tag === "Invalid"),
                              h.OnInput((value) => Message.UpdatedName({ value })),
                              h.Class("rounded border px-3 py-2"),
                            ]),
                            error(model.name, h),
                          ],
                        ),
                        h.div(
                          [h.Class("flex flex-col gap-1")],
                          [
                            h.label([h.For(Listbox.buttonId(TypeListboxId))], ["Type"]),
                            h.submodel({
                              slotId: TypeListboxId,
                              model: model.typeListbox,
                              view: TypeListbox.view,
                              viewInputs: {
                                items: ["web_scrape"],
                                maybeSelectedValue: Option.some(model.type),
                                buttonContent: h.span([], ["Web scrape"]),
                                buttonClassName: "w-full rounded border px-3 py-2 text-left",
                                itemsClassName: "rounded border bg-white py-1 shadow-lg",
                                isDisabled: true,
                                anchor: { placement: "bottom-start", gap: 4, padding: 8 },
                                itemToConfig: () => ({ content: h.span([], ["Web scrape"]) }),
                              },
                              toParentMessage: (message) =>
                                Message.GotTypeListboxMessage({ message }),
                            }),
                          ],
                        ),
                        h.label(
                          [h.Class("flex flex-col gap-1")],
                          [
                            "URL",
                            h.input([
                              h.Type("text"),
                              h.Value(model.url.value),
                              h.AriaInvalid(model.url._tag === "Invalid"),
                              h.OnInput((value) => Message.UpdatedUrl({ value })),
                              h.Class("rounded border px-3 py-2"),
                            ]),
                            error(model.url, h),
                          ],
                        ),
                        h.label(
                          [h.Class("flex flex-col gap-1")],
                          [
                            "Notes (optional)",
                            h.textarea([
                              h.Value(model.notes.value),
                              h.OnInput((value) => Message.UpdatedNotes({ value })),
                              h.Class("rounded border px-3 py-2"),
                            ]),
                          ],
                        ),
                        h.div(
                          [h.Class("flex justify-end gap-2")],
                          [
                            h.button(
                              [
                                ...closeButton,
                                h.Type("button"),
                                h.Class("rounded border px-3 py-2"),
                              ],
                              ["Cancel"],
                            ),
                            h.button(
                              [
                                h.Type("submit"),
                                h.Class("rounded bg-gray-900 px-3 py-2 text-white"),
                              ],
                              ["Create source"],
                            ),
                          ],
                        ),
                      ],
                    ),
                  ],
                ),
              ]
            : [],
        ),
    },
  });
});
