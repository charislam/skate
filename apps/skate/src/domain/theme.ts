import { Effect, Option, Schema, Stream } from "effect";
import { BrowserKeyValueStore } from "@effect/platform-browser";
import { KeyValueStore } from "effect/unstable/persistence";
import { Command, Html, Submodel, Subscription, Update } from "foldkit";
import type { HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";
import { evo } from "foldkit/struct";

export const Theme_ = Schema.Literals(["light", "dark"]);
export type Theme_ = typeof Theme_.Type;

const userThemeKey = "skate.userTheme";

export const loadUserTheme = Effect.fn("Theme.loadUserTheme")(function* () {
  const store = yield* KeyValueStore.KeyValueStore;
  const value = yield* store.get(userThemeKey);
  if (value === undefined) {
    return Option.none<Theme_>();
  }
  return Option.some(yield* Schema.decodeUnknownEffect(Theme_)(value));
});

export const saveUserTheme = Effect.fn("Theme.saveUserTheme")(function* (
  theme: Option.Option<Theme_>,
) {
  const store = yield* KeyValueStore.KeyValueStore;
  yield* Option.match(theme, {
    onNone: () => store.remove(userThemeKey),
    onSome: (value) => store.set(userThemeKey, value),
  });
});

// MODEL

export const Model = Schema.Struct({
  userTheme: Schema.Option(Theme_),
  systemTheme: Theme_,
});

export type Model = typeof Model.Type;

// BOOT

// MESSAGE

export const Message = defineMessageUnion({
  SelectedTheme: { theme: Schema.Option(Theme_) },
  SystemThemeChanged: { theme: Theme_ },
  CompletedResolveTheme: {},
  CompletedSaveUserTheme: {},
  FailedSaveUserTheme: {},
});

export type Message = typeof Message.Type;

// COMMAND

export const ResolveTheme = Command.define("ResolveTheme", {
  args: {
    userTheme: Schema.Option(Theme_),
    systemTheme: Theme_,
  },
  messages: [Message.CompletedResolveTheme],
  execute: ({ userTheme, systemTheme }) =>
    Effect.sync(() => {
      const resolvedTheme = Option.getOrElse(userTheme, () => systemTheme);

      const htmlElement = document.documentElement;
      if (resolvedTheme === "dark") {
        htmlElement.classList.add("dark");
      } else {
        htmlElement.classList.remove("dark");
      }
    }).pipe(Effect.as(Message.CompletedResolveTheme())),
});

export const SaveUserTheme = Command.define("SaveUserTheme", {
  args: { theme: Schema.Option(Theme_) },
  messages: [Message.CompletedSaveUserTheme, Message.FailedSaveUserTheme],
  execute: ({ theme }) =>
    saveUserTheme(theme).pipe(
      Effect.provide(BrowserKeyValueStore.layerLocalStorage),
      Effect.as(Message.CompletedSaveUserTheme()),
      Effect.catch(() => Effect.succeed(Message.FailedSaveUserTheme())),
    ),
});

export const boot = (flags: {
  systemTheme: Theme_;
  maybeUserTheme: Option.Option<Theme_>;
}): Update.Return<Model, Message> => {
  const userTheme = flags.maybeUserTheme;
  return {
    model: {
      userTheme,
      systemTheme: flags.systemTheme,
    },
    commands: [ResolveTheme({ userTheme, systemTheme: flags.systemTheme })],
  };
};

// UPDATE

export const update = (model: Model, message: Message): Update.Return<Model, Message> =>
  Message.match<Update.Return<Model, Message>>(message, {
    SelectedTheme: ({ theme }) => ({
      model: evo(model, { userTheme: () => theme }),
      commands: [
        ResolveTheme({ userTheme: theme, systemTheme: model.systemTheme }),
        SaveUserTheme({ theme }),
      ],
    }),
    SystemThemeChanged: ({ theme }) => ({
      model: evo(model, { systemTheme: () => theme }),
      commands: [ResolveTheme({ userTheme: model.userTheme, systemTheme: theme })],
    }),
    CompletedResolveTheme: () => ({
      model,
    }),
    CompletedSaveUserTheme: () => ({ model }),
    FailedSaveUserTheme: () => ({ model }),
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
