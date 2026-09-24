import { Effect, Option, Schema, Stream } from "effect";
import { Command, Html, Submodel, Subscription, Update } from "foldkit";
import type { HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";
import { evo } from "foldkit/struct";

export const Theme_ = Schema.Literals(["light", "dark"]);
export type Theme_ = typeof Theme_.Type;

// MODEL

export const Model = Schema.Struct({
  userTheme: Schema.Option(Theme_),
  systemTheme: Theme_,
});

export type Model = typeof Model.Type;

// BOOT

export const boot = (flags: { systemTheme: Theme_ }): Update.Return<Model, Message> => ({
  model: {
    userTheme: Option.none(),
    systemTheme: flags.systemTheme,
  },
});

// MESSAGE

export const Message = defineMessageUnion({
  SelectedTheme: { theme: Schema.Option(Theme_) },
  SystemThemeChanged: { theme: Theme_ },
  CompletedResolveTheme: {},
});

export type Message = typeof Message.Type;

// COMMAND

const ResolveTheme = Command.define("ResolveTheme", {
  args: {
    userTheme: Schema.Option(Theme_),
    systemTheme: Theme_,
  },
  messages: [Message.CompletedResolveTheme],
  execute: ({ userTheme, systemTheme }) => {
    const resolvedTheme = Option.getOrElse(userTheme, () => systemTheme);

    const htmlElement = document.documentElement;
    if (resolvedTheme === "dark") {
      htmlElement.classList.add("dark");
    } else {
      htmlElement.classList.remove("dark");
    }

    return Effect.succeed(Message.CompletedResolveTheme());
  },
});

// UPDATE

export const update = (model: Model, message: Message): Update.Return<Model, Message> =>
  Message.match<Update.Return<Model, Message>>(message, {
    SelectedTheme: ({ theme }) => ({
      model: evo(model, { userTheme: () => theme }),
      commands: [ResolveTheme({ userTheme: theme, systemTheme: model.systemTheme })],
    }),
    SystemThemeChanged: ({ theme }) => ({
      model: evo(model, { systemTheme: () => theme }),
      commands: [ResolveTheme({ userTheme: model.userTheme, systemTheme: theme })],
    }),
    CompletedResolveTheme: () => ({
      model,
    }),
  });

// SUBSCRIPTION

export const subscriptions = Subscription.make<Model, Message>()((entry) => ({
  systemPreference: entry(
    {},
    {
      modelToDependencies: () => ({}),
      dependenciesToStream: () =>
        Stream.unwrap(
          Effect.sync(() => {
            const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

            return Subscription.fromEvent<MediaQueryListEvent, Message>({
              target: mediaQuery,
              type: "change",
              toMessage: (event) =>
                Message.SystemThemeChanged({ theme: event.matches ? "dark" : "light" }),
            });
          }),
        ),
    },
  ),
}));

// VIEW

export type ViewInputs = Readonly<{
  toView: (theme: Theme_, h: HtmlBuilder<Message>) => Html.Html;
}>;

export const view = Submodel.defineView<Model, Message, ViewInputs>((model, viewInputs, h) => {
  const resolvedTheme = Option.getOrElse(model.userTheme, () => model.systemTheme);
  return viewInputs.toView(resolvedTheme, h);
});

// API

export const setTheme = (model: Model, theme: Option.Option<Theme_>) =>
  update(model, Message.SelectedTheme({ theme }));

export * as Theme from "./theme";
