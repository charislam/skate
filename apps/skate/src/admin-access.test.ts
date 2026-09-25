import { Option, Result } from "effect";
import { AsyncData, Calendar } from "foldkit";
import { fromString } from "foldkit/url";
import { describe, expect, test } from "vitest";
import { init, update } from "./main";
import { Message } from "./message";
import { AdminAccess, PermissionError, canAccessAdmin } from "./domain/admin-access";
import { UserId } from "./domain/session";
import { type Model } from "./model";

const session = { userId: UserId.make("owner"), email: Option.none<string>() };
const url = (path: string) => Option.getOrThrow(fromString(`http://localhost${path}`));
const boot = (path = "/admin") =>
  init(
    {
      today: Calendar.make(2026, 9, 25),
      theme: "light",
      tabletOrAbove: true,
      maybeSession: Option.some(session),
    },
    url(path),
  );
const settle = (model: Model, allowed: boolean) =>
  update(
    model,
    Message.SettledFetchAdminAccess({
      userId: session.userId,
      requestId: model.adminAccessRequestId,
      result: Result.succeed(allowed),
    }),
  ).model;

describe("admin authorization", () => {
  test("restored sessions load access without discarding the requested URL", () => {
    const initial = boot();
    expect(initial.model.route._tag).toBe("Admin");
    expect(initial.commands?.some((command) => command.name === "FetchAdminAccess")).toBe(true);
    expect(initial.model._tag === "LoggedIn" && initial.model.adminAccess._tag).toBe("Loading");
    const allowed = settle(initial.model, true);
    expect(allowed._tag === "LoggedIn" && canAccessAdmin(allowed.adminAccess)).toBe(true);
    expect(settle(initial.model, false).route._tag).toBe("Home");
  });

  test("invalidation deduplicates pending requests and blocks stale grants", () => {
    const pending = boot().model;
    expect(update(pending, Message.InvalidatedAdminAccess())).toEqual({ model: pending });
    const allowed = settle(pending, true);
    const refresh = update(allowed, Message.InvalidatedAdminAccess());
    expect(refresh.model._tag === "LoggedIn" && refresh.model.adminAccess._tag).toBe("Refreshing");
    expect(refresh.model._tag === "LoggedIn" && canAccessAdmin(refresh.model.adminAccess)).toBe(
      false,
    );
    expect(settle(refresh.model, false).route._tag).toBe("Home");
  });

  test("route entry revalidates a cached grant", () => {
    const allowed = settle(boot("/").model, true);
    const next = update(allowed, Message.ChangedUrl({ url: url("/admin") }));
    expect(next.model._tag === "LoggedIn" && next.model.adminAccess._tag).toBe("Refreshing");
    expect(
      "commands" in next && next.commands?.some((command) => command.name === "FetchAdminAccess"),
    ).toBe(true);
  });

  test("failed revalidation retains identity and supports retry without granting access", () => {
    const refresh = update(settle(boot().model, true), Message.InvalidatedAdminAccess()).model;
    const failed = update(
      refresh,
      Message.SettledFetchAdminAccess({
        userId: session.userId,
        requestId: refresh.adminAccessRequestId,
        result: Result.fail(new PermissionError({ message: "Unavailable" })),
      }),
    ).model;
    expect(failed._tag).toBe("LoggedIn");
    expect(failed._tag === "LoggedIn" && failed.adminAccess._tag).toBe("Stale");
    expect(failed._tag === "LoggedIn" && canAccessAdmin(failed.adminAccess)).toBe(false);
    const retry = update(failed, Message.ClickedRetryAdminAccess());
    expect(retry.model._tag === "LoggedIn" && AsyncData.isPending(retry.model.adminAccess)).toBe(
      true,
    );
  });

  test("old requests cannot restore permissions after signing out and back in", () => {
    const pending = boot().model;
    const loggedOut = update(
      pending,
      Message.AuthStateChanged({ maybeSession: Option.none() }),
    ).model;
    expect(settle(loggedOut, true)._tag).toBe("LoggedOut");
    const signedIn = update(
      loggedOut,
      Message.AuthStateChanged({ maybeSession: Option.some(session) }),
    ).model;
    const stale = update(
      signedIn,
      Message.SettledFetchAdminAccess({
        userId: session.userId,
        requestId: pending.adminAccessRequestId,
        result: Result.succeed(true),
      }),
    ).model;
    expect(stale).toEqual(signedIn);
    expect(signedIn.adminAccessRequestId).toBeGreaterThan(pending.adminAccessRequestId);
  });

  test("switching accounts clears the previous grant", () => {
    const allowed = settle(boot().model, true);
    const switched = update(
      allowed,
      Message.AuthStateChanged({
        maybeSession: Option.some({ ...session, userId: UserId.make("member") }),
      }),
    ).model;
    expect(switched._tag === "LoggedIn" && switched.adminAccess).toEqual(AdminAccess.Loading());
    expect(settle(switched, true)).toEqual(switched);
  });
});
