import { Listbox, Dialog as UiDialog } from "@foldkit/ui";
import { cn } from "cn";
import { Array, Option } from "effect";
import { FieldValidation, Submodel } from "foldkit";
import type { HtmlBuilder } from "foldkit/html";
import { Button } from "~/view/button";
import { Form } from "~/view/form";
import { TypeListbox, TypeListboxId } from "./listbox";
import { Message } from "./message";
import type { Model } from "./model";
import { Dialog } from "~/view/dialog";

const error = (field: FieldValidation.Field<string>, h: HtmlBuilder<Message>) =>
  field._tag === "Invalid"
    ? h.p(
        [h.Role("alert"), h.Class("ml-2 text-sm text-red-800 dark:text-red-100")],
        [Array.headNonEmpty(field.errors)],
      )
    : h.empty;

const nameInput = (model: Model, h: HtmlBuilder<Message>) =>
  h.div(
    [],
    [
      h.label(
        [h.Class(Form.inputFieldClass)],
        [
          h.span([h.Class(Form.labelClass)], ["Name"]),
          h.input([
            h.Type("text"),
            h.Value(model.name.value),
            h.AriaInvalid(model.name._tag === "Invalid"),
            h.OnInput((value) => Message.UpdatedName({ value })),
            h.Class(Form.inputClass),
          ]),
        ],
      ),
      error(model.name, h),
    ],
  );

const typeInput = (model: Model, h: HtmlBuilder<Message>) =>
  h.div(
    [h.Class(Form.inputFieldClass)],
    [
      h.label([h.For(Listbox.buttonId(TypeListboxId)), h.Class(Form.labelClass)], ["Type"]),
      h.submodel({
        slotId: TypeListboxId,
        model: model.typeListbox,
        view: TypeListbox.view,
        viewInputs: {
          items: ["web_scrape"],
          isDisabled: true,
          maybeSelectedValue: Option.some(model.type),
          buttonContent: h.span([], ["Web scrape"]),
          buttonClassName: `${Form.inputClass} w-full text-left`,
          itemsClassName:
            "border border-slate-100 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800",
          anchor: { placement: "bottom-start", gap: 4, padding: 8 },
          itemToConfig: () => ({ content: h.span([], ["Web scrape"]) }),
        },
        toParentMessage: (message) => Message.GotTypeListboxMessage({ message }),
      }),
    ],
  );

const notesInput = (model: Model, h: HtmlBuilder<Message>) =>
  h.label(
    [h.Class(Form.inputFieldClass)],
    [
      h.span([h.Class(Form.labelClass)], ["Notes (optional)"]),
      h.textarea([
        h.Value(model.notes.value),
        h.OnInput((value) => Message.UpdatedNotes({ value })),
        h.Class(Form.inputClass),
      ]),
    ],
  );

const urlInput = (model: Model, h: HtmlBuilder<Message>) =>
  h.div(
    [],
    [
      h.label(
        [h.Class(Form.inputFieldClass)],
        [
          h.span([h.Class(Form.labelClass)], ["URL"]),
          h.input([
            h.Type("text"),
            h.Value(model.url.value),
            h.AriaInvalid(model.url._tag === "Invalid"),
            h.OnInput((value) => Message.UpdatedUrl({ value })),
            h.Class(Form.inputClass),
          ]),
        ],
      ),
      error(model.url, h),
    ],
  );

export const view = Submodel.defineView<Model, Message>((model, h) => {
  return h.submodel({
    slotId: model.dialog.id,
    model: model.dialog,
    view: UiDialog.view,
    toParentMessage: (message) => Message.GotDialogMessage({ message }),
    viewInputs: {
      hasDescription: true,
      toView: ({ dialog, backdrop, panel, title, description, closeButton, isVisible }) =>
        h.dialog(
          [...dialog, h.Class(Dialog.wrapperClass)],
          isVisible
            ? [
                h.div([...backdrop, h.Class(Dialog.backdropClass)]),
                h.div(
                  [...panel, h.Class(Dialog.panelClass)],
                  [
                    h.h2([...title, h.Class("text-xl font-semibold")], ["Create source"]),
                    h.p(
                      [...description, h.Class("mt-2 text-sm text-slate-600 dark:text-slate-300")],
                      ["Add a web scrape source to collect from."],
                    ),
                    h.form(
                      [h.OnSubmit(Message.SubmittedForm()), h.Class("mt-4 flex flex-col gap-4")],
                      [
                        nameInput(model, h),
                        typeInput(model, h),
                        urlInput(model, h),
                        notesInput(model, h),
                        h.div(
                          [h.Class("flex justify-end gap-2")],
                          [
                            h.button(
                              [...closeButton, h.Type("button"), h.Class(Button.dialogCancelClass)],
                              ["Cancel"],
                            ),
                            h.button(
                              [h.Type("submit"), h.Class(cn(Button.dialogConfirmClass))],
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
