import {
  Deferred,
  Effect,
  Layer,
  Match,
  Option,
  Ref,
  Schema,
  Stream,
  SubscriptionRef,
} from "effect";
import * as Resource from "~/resource";
import type { AuthEvent, Project, User } from "./model";
import type { ProjectId } from "./routes";

export class MockAuth extends Resource.Service<
  MockAuth,
  {
    readonly sessions: Stream.Stream<AuthEvent>;
    readonly resolve: (user: Option.Option<User>) => Effect.Effect<void>;
    readonly signIn: (user: User) => Effect.Effect<void>;
    readonly logout: Effect.Effect<void>;
    readonly expire: Effect.Effect<void>;
    readonly refresh: Effect.Effect<void>;
  }
>()("RoutingDemo/Auth") {}

export const mockAuth = Layer.effect(
  MockAuth,
  Effect.gen(function* () {
    const session = yield* SubscriptionRef.make<AuthEvent>({ _tag: "Pending" });
    let sessionSequence = 0;
    const signIn = (user: User) =>
      SubscriptionRef.set(session, {
        _tag: "Session",
        sessionId: `session-${++sessionSequence}`,
        user,
      });
    return MockAuth.of({
      sessions: SubscriptionRef.changes(session),
      signIn: Effect.fn("MockAuth.signIn")((user: User) => Effect.suspend(() => signIn(user))),
      resolve: (user) =>
        Effect.suspend(() =>
          Option.match(user, {
            onNone: () => SubscriptionRef.set(session, { _tag: "Ended", reason: "discovery" }),
            onSome: signIn,
          }),
        ),
      logout: SubscriptionRef.set(session, { _tag: "Ended", reason: "logout" }),
      expire: SubscriptionRef.set(session, { _tag: "Ended", reason: "expiry" }),
      refresh: Effect.gen(function* () {
        const current = yield* SubscriptionRef.get(session);
        yield* SubscriptionRef.set(session, { ...current });
      }),
    });
  }),
);

export class ProjectError extends Schema.TaggedError<ProjectError>()("DemoProjectError", {
  message: Schema.String,
}) {}

export type AcquisitionMode = "Immediate" | "Delayed" | "Failed";

export class MockProjects extends Resource.Service<
  MockProjects,
  {
    readonly acquire: (id: ProjectId) => Effect.Effect<Project, ProjectError>;
    readonly mode: (mode: AcquisitionMode) => Effect.Effect<void>;
    readonly complete: (success: boolean) => Effect.Effect<void>;
    readonly pending: Stream.Stream<number>;
  }
>()("RoutingDemo/Projects") {}

export const mockProjects = Layer.effect(
  MockProjects,
  Effect.gen(function* () {
    const mode = yield* Ref.make<AcquisitionMode>("Immediate");
    const count = yield* SubscriptionRef.make(0);
    const requests = new Set<Deferred.Deferred<Project, ProjectError>>();
    const ids = new Map<Deferred.Deferred<Project, ProjectError>, ProjectId>();
    const project = (id: ProjectId): Project => ({ id, name: `Project ${id}` });
    const acquire = Effect.fn("MockProjects.acquire")(function* (id: ProjectId) {
      const selected = yield* Ref.get(mode);
      return yield* Match.value(selected).pipe(
        Match.when("Immediate", () => Effect.succeed(project(id))),
        Match.when("Failed", () =>
          Effect.fail(new ProjectError({ message: `Project ${id} could not be acquired` })),
        ),
        Match.when("Delayed", () =>
          Effect.acquireUseRelease(
            Effect.gen(function* () {
              const request = Deferred.makeUnsafe<Project, ProjectError>();
              requests.add(request);
              ids.set(request, id);
              yield* SubscriptionRef.set(count, requests.size);
              return request;
            }),
            Deferred.await,
            (request) =>
              Effect.gen(function* () {
                requests.delete(request);
                ids.delete(request);
                yield* SubscriptionRef.set(count, requests.size);
              }),
          ),
        ),
        Match.exhaustive,
      );
    });
    return MockProjects.of({
      acquire,
      mode: (value) => Ref.set(mode, value),
      pending: SubscriptionRef.changes(count),
      complete: (success) =>
        Effect.gen(function* () {
          for (const request of requests) {
            const id = yield* Option.match(Option.fromUndefinedOr(ids.get(request)), {
              onNone: () => Effect.die("Missing mock request ID"),
              onSome: Effect.succeed,
            });
            yield* Match.value(success).pipe(
              Match.when(true, () => Deferred.succeed(request, project(id))),
              Match.orElse(() =>
                Deferred.fail(request, new ProjectError({ message: `Project ${id} failed` })),
              ),
            );
          }
        }),
    });
  }),
);

export const mockResources = Layer.mergeAll(mockAuth, mockProjects);
