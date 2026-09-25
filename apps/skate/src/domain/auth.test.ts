import { describe, expect, test } from "vitest";
import { AuthApiError, AuthWeakPasswordError } from "@supabase/supabase-js";

import { fromAuthFailure } from "./auth";

describe("Auth errors", () => {
  test("classifies Supabase invalid credential errors with app-owned copy and cause", () => {
    const cause = new AuthApiError("invalid login credentials", 400, "invalid_credentials");
    const error = fromAuthFailure("signInWithPassword", cause);

    expect(error.kind).toBe("InvalidCredentials");
    expect(error.message).toBe("The email or password is incorrect.");
    expect(error.cause).toBe(cause);
  });

  test("classifies Supabase weak password errors as recoverable input errors", () => {
    const cause = new AuthWeakPasswordError("Password is too short", 400, ["length"]);
    const error = fromAuthFailure("signInWithPassword", cause);

    expect(error.kind).toBe("WeakPassword");
    expect(error.cause).toBe(cause);
  });

  test("does not use sign-in instructions for session restoration failures", () => {
    const cause = new AuthApiError("not confirmed", 400, "email_not_confirmed");
    const error = fromAuthFailure("getSession", cause);

    expect(error.message).toBe("We couldn't restore your sign-in session.");
  });
});
