import { Option, Result } from "effect";
import { describe, expect, test } from "vitest";
import { Command, given, message, model, story } from "foldkit/story";
import { AdminAccess, PermissionError, canAccessAdmin } from "../../domain/admin-access";
import { SourceError } from "../../domain/sources";
import { UserId } from "../../domain/session";
import { Message, OutMessage } from "./message";
import { type Model as AdminModel, init } from "./model";
import { enterSection, update } from "./update";
import { Message as SourcesMessage } from "./sources/message";
import { ScopeId } from "./sources/model";
import { FetchPage } from "./sources/update";

const session = { userId: UserId.make("owner"), email: Option.none<string>() };
const context = { userId: session.userId, maybeAdminSection: Option.none() };

describe("admin submodel", () => {
  test("loads and settles admin access", () => {
    const initial = init();
    const pending = update(initial, Message.InvalidatedAccess(), context);
    expect(pending.model.adminAccess._tag).toBe("Loading");
    expect(
      pending.commands?.some(
        (command) =>
          command.name === "FetchAdminAccess" &&
          command.args?.["adminRequestId"] === 1 &&
          command.args?.["userId"] === session.userId,
      ),
    ).toBe(true);
    const settled = update(
      pending.model,
      Message.SettledFetchAccess({
        userId: session.userId,
        adminRequestId: 1,
        result: Result.succeed(true),
      }),
      context,
    );
    expect(canAccessAdmin(settled.model.adminAccess)).toBe(true);
  });

  test("a failed revalidation does not keep access", () => {
    const initial = { ...init(), adminAccess: AdminAccess.Success({ data: true }) };
    const pending = update(initial, Message.InvalidatedAccess(), context);
    const failed = update(
      pending.model,
      Message.SettledFetchAccess({
        userId: session.userId,
        adminRequestId: 1,
        result: Result.fail(new PermissionError({ message: "Unavailable" })),
      }),
      context,
    );
    expect(failed.model.adminAccess._tag).toBe("Stale");
    expect(canAccessAdmin(failed.model.adminAccess)).toBe(false);
  });

  test("entering Overview loads the active source count once and keeps it cached", () => {
    const requested = enterSection(init(), "Overview");
    expect(requested.model.activeSourceCount._tag).toBe("Loading");
    expect(
      requested.commands?.some(
        (command) =>
          command.name === "FetchActiveSources" && command.args?.["sourceRequestId"] === 1,
      ),
    ).toBe(true);

    const settled = update(
      requested.model,
      Message.SettledFetchActiveSources({
        sourceRequestId: 1,
        result: Result.succeed(12),
      }),
      context,
    );
    expect(settled.model.activeSourceCount).toEqual({ _tag: "Success", data: 12 });

    const revisited = enterSection(settled.model, "Overview");
    expect(revisited.model.activeSourceCount).toEqual({ _tag: "Success", data: 12 });
    expect(revisited.commands).toBeUndefined();
  });

  test("entering Overview retries a failed source count request", () => {
    const failed = update(
      enterSection(init(), "Overview").model,
      Message.SettledFetchActiveSources({
        sourceRequestId: 1,
        result: Result.fail(new SourceError({ message: "Unavailable", cause: new Error() })),
      }),
      context,
    );

    const retried = enterSection(failed.model, "Overview");
    expect(retried.model.activeSourceCount._tag).toBe("Loading");
    expect(
      retried.commands?.some(
        (command) =>
          command.name === "FetchActiveSources" && command.args?.["sourceRequestId"] === 2,
      ),
    ).toBe(true);
  });

  test("entering Sources does not load the Overview count", () => {
    const enteredSources = enterSection(init(), "Sources");
    expect(enteredSources.model.activeSourceCount._tag).toBe("Idle");
    expect(enteredSources.commands).toBeUndefined();
  });

  test("successful access revalidation enters Sources through its child fold", () => {
    const sourcesTable = {
      ...init().sourcesTable,
      scopeId: Option.some(ScopeId.make("admin-source-fold-test")),
    };
    const initial = {
      ...init(),
      adminAccess: AdminAccess.Loading(),
      adminRequestId: 1,
      sourcesTable,
    };
    const sourcesContext = {
      ...context,
      maybeAdminSection: Option.some("Sources" as const),
    };
    const pageRequest = FetchPage({
      requestId: 1,
      scopeId: ScopeId.make("admin-source-fold-test"),
      userId: session.userId,
      kind: "Initial",
      query: sourcesTable.query,
      maybeCursor: Option.none(),
    });
    const updateForSourcesStory = (current: AdminModel, nextMessage: typeof Message.Type) =>
      update(current, nextMessage, sourcesContext);

    story(
      updateForSourcesStory,
      given(initial),
      message(
        Message.SettledFetchAccess({
          userId: session.userId,
          adminRequestId: 1,
          result: Result.succeed(true),
        }),
      ),
      Command.expectExact(pageRequest),
      Command.resolve(
        pageRequest,
        SourcesMessage.SettledPage({
          requestId: 1,
          scopeId: ScopeId.make("admin-source-fold-test"),
          userId: session.userId,
          kind: "Initial",
          maybeCursor: Option.none(),
          result: Result.succeed({ items: [], nextCursor: Option.none() }),
        }),
      ),
      model((current) => {
        expect(current.adminAccess).toEqual(AdminAccess.Success({ data: true }));
        expect(current.sourcesTable.feed._tag).toBe("Success");
      }),
    );
  });

  test("logout is reported to the parent", () => {
    expect(update(init(), Message.ClickedLogout(), context).outMessage).toEqual(
      OutMessage.RequestedLogout(),
    );
  });
});
