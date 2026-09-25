import { Array } from "effect";
import { FieldValidation, Submodel } from "foldkit";
import { Auth } from "../../domain/auth";
import { Message } from "./message";
import { type Model } from "./model";

export const view = Submodel.defineView<Model, Message>((model, h) =>
  h.section(
    [],
    [
      h.h1([h.Class("text-3xl mb-6")], ["Sign in"]),
      h.form(
        [h.Class("flex flex-col gap-4"), h.OnSubmit(Message.SubmittedForm())],
        [
          h.div(
            [],
            [
              h.label(
                [],
                [
                  "Email",
                  h.input([
                    h.Type("email"),
                    h.Value(model.email.value),
                    h.Required(true),
                    h.Disabled(model._tag === "Submitting"),
                    h.AriaInvalid(model.email._tag === "Invalid"),
                    h.OnInput((value) => Message.UpdatedEmail({ value })),
                    h.OnBlur(Message.BlurredEmail()),
                  ]),
                ],
              ),
              FieldValidation.match(model.email, {
                onNotValidated: () => h.empty,
                onValidating: () => h.empty,
                onValid: () => h.empty,
                onInvalid: ({ errors }) =>
                  h.p([h.Class("text-sm text-red-700")], [Array.headNonEmpty(errors)]),
              }),
            ],
          ),
          h.div(
            [],
            [
              h.label(
                [],
                [
                  "Password",
                  h.input([
                    h.Type("password"),
                    h.Value(model.password.value),
                    h.Required(true),
                    h.Minlength(8),
                    h.Disabled(model._tag === "Submitting"),
                    h.AriaInvalid(model.password._tag === "Invalid"),
                    h.OnInput((value) => Message.UpdatedPassword({ value })),
                    h.OnBlur(Message.BlurredPassword()),
                  ]),
                ],
              ),
              FieldValidation.match(model.password, {
                onNotValidated: () => h.empty,
                onValidating: () => h.empty,
                onValid: () => h.empty,
                onInvalid: ({ errors }) =>
                  h.p([h.Class("text-sm text-red-700")], [Array.headNonEmpty(errors)]),
              }),
            ],
          ),
          h.p(
            [h.Role("alert"), h.AriaLive("assertive"), h.Class("text-red-700")],
            [model._tag === "Failed" ? Auth.messageForKind(model.kind) : ""],
          ),
          h.button(
            [h.Type("submit"), h.Disabled(model._tag === "Submitting")],
            [model._tag === "Submitting" ? "Signing in…" : "Sign in"],
          ),
        ],
      ),
    ],
  ),
);
