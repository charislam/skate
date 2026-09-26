import { describe, expect, test } from "vitest";
import { AdminAccess, PermissionError, canAccessAdmin } from "./admin-access";

describe("canAccessAdmin", () => {
  test.each([
    ["idle", AdminAccess.Idle(), false],
    ["loading", AdminAccess.Loading(), false],
    [
      "failure",
      AdminAccess.Failure({ error: new PermissionError({ message: "Unavailable" }) }),
      false,
    ],
    ["success true", AdminAccess.Success({ data: true }), true],
    ["refreshing true", AdminAccess.Refreshing({ data: true }), true],
    [
      "stale true",
      AdminAccess.Stale({ data: true, error: new PermissionError({ message: "Unavailable" }) }),
      true,
    ],
    ["success false", AdminAccess.Success({ data: false }), false],
    ["refreshing false", AdminAccess.Refreshing({ data: false }), false],
    [
      "stale false",
      AdminAccess.Stale({ data: false, error: new PermissionError({ message: "Unavailable" }) }),
      false,
    ],
  ] as const)("returns %s permission", (_name, access, allowed) => {
    expect(canAccessAdmin(access)).toBe(allowed);
  });
});
