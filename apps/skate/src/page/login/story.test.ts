import { Option } from "effect";
import { Command, expectOutMessage, given, message, model, story } from "foldkit/story";
import { describe, expect, test } from "vitest";

import { UserId } from "../../domain/session";
import { AppRoute } from "../../route";
import { SignInWithPassword, update } from "./update";
import { Message, OutMessage } from "./message";
import { init } from "./model";

const updateWithContext = (model: ReturnType<typeof init>, message: Message) =>
  update(model, message, { route: AppRoute.Login() });

describe("login update", () => {
  test("validates required email and password before issuing a command", () => {
    story(
      updateWithContext,
      given(init()),
      message(Message.SubmittedForm()),
      model((next) => {
        expect(next._tag).toBe("Editing");
        expect(next.email).toMatchObject({ _tag: "Invalid", errors: ["Email is required"] });
        expect(next.password).toMatchObject({ _tag: "Invalid", errors: ["Password is required"] });
      }),
      Command.expectNone(),
    );
  });

  test("rejects a short password before issuing a command", () => {
    story(
      updateWithContext,
      given(init()),
      message(Message.UpdatedEmail({ value: "person@example.com" })),
      message(Message.UpdatedPassword({ value: "short" })),
      message(Message.SubmittedForm()),
      model((next) => {
        expect(next._tag).toBe("Editing");
        expect(next.password).toMatchObject({
          _tag: "Invalid",
          errors: ["Password must be at least 8 characters."],
        });
      }),
      Command.expectNone(),
    );
  });

  test("submits valid credentials and maps a typed auth failure to a login message", () => {
    story(
      updateWithContext,
      given(init()),
      message(Message.UpdatedEmail({ value: "person@example.com" })),
      message(Message.UpdatedPassword({ value: "secret123" })),
      message(Message.SubmittedForm()),
      model((next) => expect(next._tag).toBe("Submitting")),
      Command.expectHas(SignInWithPassword({ email: "person@example.com", password: "secret123" })),
      Command.resolve(SignInWithPassword, Message.FailedSignIn({ kind: "InvalidCredentials" })),
      model((next) => {
        expect(next._tag).toBe("Failed");
        if (next._tag === "Failed") expect(next.kind).toBe("InvalidCredentials");
      }),
      Command.expectNone(),
    );
  });

  test("emits a session as an out message after successful sign in", () => {
    const session = { userId: UserId.make("user-1"), email: Option.some("person@example.com") };
    story(
      updateWithContext,
      given(init()),
      message(Message.SucceededSignIn({ session })),
      model((next) => expect(next).toEqual(init())),
      expectOutMessage(OutMessage.SucceededLogin({ session })),
    );
  });
});
