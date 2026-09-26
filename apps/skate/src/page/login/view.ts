import { Array, Option } from "effect";
import { FieldValidation, Submodel } from "foldkit";
import { Auth } from "../../domain/auth";
import { Message } from "./message";
import { type Model } from "./model";
import { cn } from "cn";
import type { HtmlBuilder } from "foldkit/html";
import { Form } from "~/view/form";

const errorField = (message: Option.Option<string>, h: HtmlBuilder<Message>) =>
  h.p(
    [h.Class(cn(Form.fieldErrorClass, Option.isNone(message) && "invisible"))],
    [Option.getOrElse(message, () => "Placeholder")],
  );

export const view = Submodel.defineView<Model, Message>((model, h) =>
  h.section(
    [],
    [
      h.form(
        [h.Class("flex flex-col gap-4"), h.OnSubmit(Message.SubmittedForm())],
        [
          h.div(
            [],
            [
              h.label(
                [h.Class(Form.inputFieldClass)],
                [
                  h.span([h.Class(Form.labelClass)], ["Email"]),
                  h.input([
                    h.Type("email"),
                    h.Value(model.email.value),
                    h.Placeholder("email@example.com"),
                    h.Required(true),
                    h.Disabled(model._tag === "Submitting"),
                    h.AriaInvalid(model.email._tag === "Invalid"),
                    h.OnInput((value) => Message.UpdatedEmail({ value })),
                    h.OnBlur(Message.BlurredEmail()),
                    h.Class(Form.inputClass),
                  ]),
                ],
              ),
              FieldValidation.match(model.email, {
                onNotValidated: () => errorField(Option.none(), h),
                onValidating: () => errorField(Option.none(), h),
                onValid: () => errorField(Option.none(), h),
                onInvalid: ({ errors }) => errorField(Option.some(Array.headNonEmpty(errors)), h),
              }),
            ],
          ),
          h.div(
            [],
            [
              h.label(
                [h.Class(Form.inputFieldClass)],
                [
                  h.span([h.Class(Form.labelClass)], ["Password"]),
                  h.input([
                    h.Type("password"),
                    h.Value(model.password.value),
                    h.Required(true),
                    h.Minlength(8),
                    h.Disabled(model._tag === "Submitting"),
                    h.AriaInvalid(model.password._tag === "Invalid"),
                    h.OnInput((value) => Message.UpdatedPassword({ value })),
                    h.OnBlur(Message.BlurredPassword()),
                    h.Class(Form.inputClass),
                  ]),
                ],
              ),
              FieldValidation.match(model.password, {
                onNotValidated: () => errorField(Option.none(), h),
                onValidating: () => errorField(Option.none(), h),
                onValid: () => errorField(Option.none(), h),
                onInvalid: ({ errors }) => errorField(Option.some(Array.headNonEmpty(errors)), h),
              }),
            ],
          ),
          h.p(
            [h.Role("alert"), h.AriaLive("assertive"), h.Class("text-red-700")],
            [model._tag === "Failed" ? Auth.messageForKind(model.kind) : ""],
          ),
          h.button(
            [
              h.Type("submit"),
              h.Disabled(model._tag === "Submitting"),
              h.Class(
                cn(
                  "cursor-pointer rounded-md px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 tracking-wider",
                  "dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300",
                ),
              ),
            ],
            [model._tag === "Submitting" ? "Signing in…" : "Sign in"],
          ),
        ],
      ),
    ],
  ),
);
