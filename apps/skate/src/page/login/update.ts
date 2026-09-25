import { Effect, Schema } from "effect";
import { Command, type Update } from "foldkit";
import { Rule, allValid, makeRules, validate } from "foldkit/fieldValidation";
import { Auth } from "../../domain/auth";
import { type AppRoute as AppRouteType } from "../../route";
import { Message, OutMessage } from "./message";
import { Model, type Model as ModelType } from "./model";

export interface Context {
  readonly route: AppRouteType;
}

export interface Input {
  readonly message: Message;
  readonly context: Context;
}

export const SignInWithPassword = Command.define("SignInWithPassword", {
  args: { email: Schema.String, password: Schema.String },
  messages: [Message.SucceededSignIn, Message.FailedSignIn],
  execute: ({ email, password }) =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service;
      const session = yield* auth.signInWithPassword({ email, password });
      return Message.SucceededSignIn({ session });
    }).pipe(
      Effect.catchTag("AuthError", (error) =>
        Effect.succeed(Message.FailedSignIn({ kind: error.kind })),
      ),
    ),
});

const emailRules = makeRules({
  required: "Email is required",
  rules: [Rule.email("Enter a valid email address.")],
});
const passwordRules = makeRules({
  required: "Password is required",
  rules: [Rule.minLength(8, "Password must be at least 8 characters.")],
});
const validateEmail = validate(emailRules);
const validatePassword = validate(passwordRules);

export const update = (model: ModelType, message: Message, context: Context) =>
  Message.match<Update.ReturnWithOutMessage<ModelType, Message, OutMessage, Auth.Service>>(
    message,
    {
      UpdatedEmail: ({ value }) =>
        model._tag === "Submitting"
          ? { model }
          : {
              model: Model.Editing({
                email:
                  model.email._tag === "NotValidated"
                    ? { ...model.email, value }
                    : validateEmail(value),
                password: model.password,
              }),
            },
      UpdatedPassword: ({ value }) =>
        model._tag === "Submitting"
          ? { model }
          : {
              model: Model.Editing({
                email: model.email,
                password:
                  model.password._tag === "NotValidated"
                    ? { ...model.password, value }
                    : validatePassword(value),
              }),
            },
      BlurredEmail: () =>
        model._tag === "Submitting"
          ? { model }
          : {
              model: Model.Editing({
                email: validateEmail(model.email.value),
                password: model.password,
              }),
            },
      BlurredPassword: () =>
        model._tag === "Submitting"
          ? { model }
          : {
              model: Model.Editing({
                email: model.email,
                password: validatePassword(model.password.value),
              }),
            },
      SubmittedForm: () => {
        if (context.route._tag !== "Login" || model._tag === "Submitting") return { model };
        const email = validateEmail(model.email.value);
        const password = validatePassword(model.password.value);
        if (
          !allValid([
            [email, emailRules],
            [password, passwordRules],
          ])
        )
          return { model: Model.Editing({ email, password }) };
        return {
          model: Model.Submitting({ email, password }),
          commands: [SignInWithPassword({ email: email.value, password: password.value })],
        };
      },
      SucceededSignIn: ({ session }) => ({
        model,
        outMessage: OutMessage.SucceededLogin({ session }),
      }),
      FailedSignIn: ({ kind }) =>
        model._tag !== "Submitting"
          ? { model }
          : {
              model: Model.Failed({
                email: model.email,
                password: model.password,
                kind,
              }),
            },
    },
  );
