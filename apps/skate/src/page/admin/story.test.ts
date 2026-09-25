import { Option, Result } from "effect";
import { describe, expect, test } from "vitest";
import { AdminAccess, PermissionError, canAccessAdmin } from "../../domain/admin-access";
import { UserId } from "../../domain/session";
import { Message, OutMessage } from "./message";
import { init } from "./model";
import { update } from "./update";

const session = { userId: UserId.make("owner"), email: Option.none<string>() };
const context = { userId: session.userId };

describe("admin submodel", () => {
  test("loads and settles admin access", () => {
    const initial = init();
    const pending = update(initial, Message.InvalidatedAccess(), context);
    expect(pending.model.adminAccess._tag).toBe("Loading");
    expect(
      pending.commands?.some(
        (command) =>
          command.name === "FetchAdminAccess" &&
          command.args?.requestId === 1 &&
          command.args?.userId === session.userId,
      ),
    ).toBe(true);
    const settled = update(
      pending.model,
      Message.SettledFetchAccess({
        userId: session.userId,
        requestId: 1,
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
        requestId: 1,
        result: Result.fail(new PermissionError({ message: "Unavailable" })),
      }),
      context,
    );
    expect(failed.model.adminAccess._tag).toBe("Stale");
    expect(canAccessAdmin(failed.model.adminAccess)).toBe(false);
  });

  test("logout is reported to the parent", () => {
    expect(update(init(), Message.ClickedLogout(), context).outMessage).toEqual(
      OutMessage.RequestedLogout(),
    );
  });
});
