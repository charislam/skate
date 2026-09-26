import { Context, Effect, Layer, Option, Queue, Schema, Stream } from "effect";
import {
  type SupabaseClient,
  type Session as SupabaseSession,
  isAuthApiError,
  isAuthRetryableFetchError,
  isAuthWeakPasswordError,
} from "@supabase/supabase-js";
import { Session as AppSession, UserId } from "./session";
import { PermissionError } from "./admin-access";
import { Supabase } from "./supabase";

export interface Credentials {
  readonly email: string;
  readonly password: string;
}

export type AuthStateChange = { readonly maybeSession: Option.Option<AppSession> };

export const ErrorKind = Schema.Literals([
  "InvalidCredentials",
  "EmailNotConfirmed",
  "WeakPassword",
  "IdentityAlreadyExists",
  "UserAlreadyExists",
  "RateLimited",
  "NetworkUnavailable",
  "SessionExpired",
  "ProviderUnavailable",
  "InvalidRequest",
  "Unexpected",
]);

export type ErrorKind = typeof ErrorKind.Type;

export class AuthError extends Schema.TaggedError<AuthError>()("AuthError", {
  operation: Schema.Literals(["getSession", "signInWithPassword", "signUp", "signOut"]),
  kind: ErrorKind,
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

const messageFor = (kind: ErrorKind, operation: AuthError["operation"]): string => {
  if (operation === "signOut") {
    return kind === "NetworkUnavailable"
      ? "Could not reach the authentication service. Try signing out again."
      : "We couldn't sign you out. Try again.";
  }
  if (operation === "getSession") {
    return kind === "NetworkUnavailable"
      ? "Could not reach the authentication service to restore your session."
      : "We couldn't restore your sign-in session.";
  }
  if (operation === "signUp") {
    if (kind === "IdentityAlreadyExists" || kind === "UserAlreadyExists")
      return "This account or identity is already registered.";
    if (kind === "WeakPassword") return "Choose a password that meets the password requirements.";
    if (kind === "EmailNotConfirmed") return "Check your email to confirm your account.";
    if (kind === "RateLimited") return "Too many attempts. Wait a few minutes and try again.";
    if (kind === "NetworkUnavailable")
      return "Could not reach the authentication service. Check your connection and try again.";
    if (kind === "InvalidRequest") return "Check the sign-up details and try again.";
    return "We couldn't create your account. Try again later.";
  }
  if (kind === "InvalidCredentials") return "The email or password is incorrect.";
  if (kind === "EmailNotConfirmed") return "Confirm your email before signing in.";
  if (kind === "RateLimited") return "Too many attempts. Wait a few minutes and try again.";
  if (kind === "NetworkUnavailable")
    return "Could not reach the authentication service. Check your connection and try again.";
  if (kind === "SessionExpired") return "Your sign-in session has expired. Sign in again.";
  if (kind === "ProviderUnavailable") return "This sign-in option is currently unavailable.";
  if (kind === "InvalidRequest") return "Check the sign-in details and try again.";
  return "We couldn't sign you in. Try again later.";
};

export const messageForKind = (kind: ErrorKind): string => messageFor(kind, "signInWithPassword");

export const messageForOperation = (kind: ErrorKind, operation: AuthError["operation"]): string =>
  messageFor(kind, operation);

const classifyError = (cause: unknown): ErrorKind => {
  if (isAuthWeakPasswordError(cause)) return "WeakPassword";
  if (isAuthApiError(cause)) {
    if (cause.code === "invalid_credentials" || cause.code === "user_not_found")
      return "InvalidCredentials";
    if (cause.code === "email_not_confirmed") return "EmailNotConfirmed";
    if (cause.code === "weak_password") return "WeakPassword";
    if (cause.code === "identity_already_exists") return "IdentityAlreadyExists";
    if (["user_already_exists", "email_exists", "phone_exists"].includes(cause.code ?? ""))
      return "UserAlreadyExists";
    if (
      cause.status === 429 ||
      [
        "over_request_rate_limit",
        "over_email_send_rate_limit",
        "over_sms_send_rate_limit",
      ].includes(cause.code ?? "")
    )
      return "RateLimited";
    if (cause.code === "request_timeout") return "NetworkUnavailable";
    if (
      [
        "session_expired",
        "refresh_token_not_found",
        "refresh_token_already_used",
        "otp_expired",
        "flow_state_expired",
        "flow_state_not_found",
      ].includes(cause.code ?? "")
    )
      return "SessionExpired";
    if (
      [
        "signup_disabled",
        "email_provider_disabled",
        "phone_provider_disabled",
        "provider_disabled",
        "oauth_provider_not_supported",
        "saml_provider_disabled",
        "anonymous_provider_disabled",
        "sso_provider_not_found",
      ].includes(cause.code ?? "")
    )
      return "ProviderUnavailable";
    if (
      [
        "validation_failed",
        "email_address_invalid",
        "email_address_not_authorized",
        "bad_json",
      ].includes(cause.code ?? "")
    )
      return "InvalidRequest";
  }
  if (isAuthRetryableFetchError(cause)) return "NetworkUnavailable";
  return "Unexpected";
};

export const fromAuthFailure = (operation: AuthError["operation"], cause: unknown): AuthError => {
  const kind = classifyError(cause);
  return new AuthError({ operation, kind, message: messageFor(kind, operation), cause });
};

export interface Interface {
  readonly hasAdminAccess: () => Effect.Effect<boolean, PermissionError>;
  readonly getSession: Effect.Effect<Option.Option<AppSession>, AuthError>;
  readonly signInWithPassword: (credentials: Credentials) => Effect.Effect<AppSession, AuthError>;
  readonly signOut: Effect.Effect<void, AuthError>;
  readonly authStateChanges: Stream.Stream<AuthStateChange>;
}

export class Service extends Context.Service<Service, Interface>()("skate/Auth") {}

const toSession = (session: SupabaseSession): AppSession => ({
  userId: UserId.make(session.user.id),
  email: Option.fromNullishOr(session.user.email),
});

const makeAuthInterface = (client: SupabaseClient): Interface => ({
  hasAdminAccess: Effect.fn("Auth.hasAdminAccess")(function* () {
    const failure = () =>
      new PermissionError({ message: "We couldn't check your admin access. Try again." });
    const { data, error } = yield* Effect.tryPromise({
      try: (signal) => client.rpc("has_admin_access", {}, { get: true }).abortSignal(signal),
      catch: failure,
    });
    if (error) {
      return yield* Effect.fail(failure());
    }
    return yield* Schema.decodeUnknownEffect(Schema.Boolean)(data).pipe(Effect.mapError(failure));
  }),
  getSession: Effect.gen(function* () {
    const { data, error } = yield* Effect.tryPromise({
      try: () => client.auth.getSession(),
      catch: (cause) => fromAuthFailure("getSession", cause),
    });
    if (error) return yield* Effect.fail(fromAuthFailure("getSession", error));
    return Option.fromNullishOr(data.session).pipe(Option.map(toSession));
  }),
  signInWithPassword: (credentials: Credentials) =>
    Effect.gen(function* () {
      const { data, error } = yield* Effect.tryPromise({
        try: () => client.auth.signInWithPassword(credentials),
        catch: (cause) => fromAuthFailure("signInWithPassword", cause),
      });
      if (error) return yield* Effect.fail(fromAuthFailure("signInWithPassword", error));
      if (!data.session)
        return yield* Effect.fail(
          fromAuthFailure("signInWithPassword", new Error("Supabase returned no session.")),
        );
      return toSession(data.session);
    }),
  signOut: Effect.gen(function* () {
    const { error } = yield* Effect.tryPromise({
      try: () => client.auth.signOut(),
      catch: (cause) => fromAuthFailure("signOut", cause),
    });
    if (error) return yield* Effect.fail(fromAuthFailure("signOut", error));
    return yield* Effect.void;
  }),
  authStateChanges: Stream.unwrap(
    Effect.gen(function* () {
      const queue = yield* Queue.unbounded<AuthStateChange>();
      const {
        data: { subscription },
      } = client.auth.onAuthStateChange((_event, session) => {
        Queue.offerUnsafe(queue, {
          maybeSession: Option.fromNullishOr(session).pipe(Option.map(toSession)),
        });
      });
      yield* Effect.addFinalizer(() => Effect.sync(() => subscription.unsubscribe()));
      return Stream.scoped(Stream.fromQueue(queue));
    }),
  ),
});

export const layerConfig = Layer.effect(
  Service,
  Effect.gen(function* () {
    const client = yield* Supabase.Service;
    return Service.of(makeAuthInterface(client));
  }).pipe(Effect.orDie),
);

export * as Auth from "./auth";
