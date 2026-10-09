import { Match, Option } from "effect";
import type { NavigationDecision, NavigationEvent } from "~/navigation";
import type { AppEvent, AppState } from "./model";
import { privatePage, publicPage } from "./pages";
import { completeProject } from "./project-transitions";
import { dashboard, login, type Destination, type NavigationTarget, urls } from "./routes";

type Decision = NavigationDecision<AppState, Destination>;
type Event = NavigationEvent<typeof urls.definitions, AppEvent>;

export const targetOf = (destination: Destination): NavigationTarget => ({
  _tag: "Matched",
  original: "",
  destination,
  ancestry: [],
});
const requested = (state: AppState): NavigationTarget =>
  Match.value(state).pipe(
    Match.tag("ResolvingSession", ({ requested }) => requested),
    Match.orElse(({ target }) => target),
  );
export const isPrivate = (target: NavigationTarget): boolean =>
  Match.value(target).pipe(
    Match.tag("Matched", ({ destination }) => destination._tag !== "Login"),
    Match.orElse(({ ancestry }) => ancestry.some((prefix) => prefix._tag !== "Login")),
  );
const admit = (options: {
  state: AppState;
  target: NavigationTarget;
  history: Decision["history"];
}): Decision => {
  const { state, target, history } = options;
  const revision = state.revision + 1;
  return Match.value(state).pipe(
    Match.tag("ResolvingSession", () => ({
      state: { _tag: "ResolvingSession" as const, requested: target, revision },
      history,
    })),
    Match.tag("Anonymous", ({ returnTo }) =>
      Match.value(isPrivate(target)).pipe(
        Match.when(true, () => ({
          state: {
            _tag: "Anonymous" as const,
            page: { _tag: "Login" as const },
            returnTo: Option.some(target),
            target: targetOf(login),
            revision,
          },
          history: { _tag: "Replace" as const, destination: login },
        })),
        Match.orElse(() => ({
          state: {
            _tag: "Anonymous" as const,
            page: publicPage(target),
            returnTo,
            target,
            revision,
          },
          history,
        })),
      ),
    ),
    Match.tag("Authenticated", (state) => {
      const redirect = target._tag === "Matched" && target.destination._tag === "Login";
      const admitted = Match.value(redirect).pipe(
        Match.when(true, () => targetOf(dashboard)),
        Match.orElse(() => target),
      );
      return {
        state: {
          ...state,
          revision,
          target: admitted,
          page: privatePage({
            target: admitted,
            previous: Option.some(state.page),
            requestId: revision,
          }),
        },
        history: Match.value(redirect).pipe(
          Match.when(true, () => ({ _tag: "Replace" as const, destination: dashboard })),
          Match.orElse(() => history),
        ),
      };
    }),
    Match.exhaustive,
  );
};
const authTransition = (options: {
  state: AppState;
  event: Extract<AppEvent, { _tag: "Auth" }>["event"];
}): Decision => {
  const { state, event } = options;
  const current = requested(state);
  return Match.value(event).pipe(
    Match.tag("Pending", () => ({ state, history: { _tag: "Keep" as const } })),
    Match.tag("Ended", ({ reason }) => {
      const returning = Match.value(reason !== "logout").pipe(
        Match.when(true, () =>
          Option.orElse(Option.filter(Option.some(current), isPrivate), () =>
            Match.value(state).pipe(
              Match.tag("Anonymous", ({ returnTo }) => returnTo),
              Match.orElse(() => Option.none<NavigationTarget>()),
            ),
          ),
        ),
        Match.orElse(() => Option.none<NavigationTarget>()),
      );
      const publicTarget = Match.value(isPrivate(current) || reason === "logout").pipe(
        Match.when(true, () => targetOf(login)),
        Match.orElse(() => current),
      );
      return {
        state: {
          _tag: "Anonymous" as const,
          page: publicPage(publicTarget),
          target: publicTarget,
          returnTo: returning,
          revision: state.revision + 1,
        },
        history: Match.value(isPrivate(current) || reason === "logout").pipe(
          Match.when(true, () => ({ _tag: "Replace" as const, destination: login })),
          Match.orElse(() => ({ _tag: "Keep" as const })),
        ),
      };
    }),
    Match.tag("Session", ({ sessionId, user }) => {
      const target = Match.value(state).pipe(
        Match.tag("Anonymous", ({ returnTo }) =>
          Option.getOrElse(returnTo, () => targetOf(dashboard)),
        ),
        Match.orElse(() => current),
      );
      const previous = Match.value(state).pipe(
        Match.tag("Authenticated", (state) =>
          Option.filter(Option.some(state.page), () => state.user.name === user.name),
        ),
        Match.orElse(() => Option.none()),
      );
      const authenticated: AppState = {
        _tag: "Authenticated",
        // Same-account authentication continues the application ownership lifetime.
        // A different account (or signing in after logout) starts a fresh lifetime.
        sessionId: Match.value(state).pipe(
          Match.tag("Authenticated", (current) =>
            Match.value(current.user.name === user.name).pipe(
              Match.when(true, () => current.sessionId),
              Match.orElse(() => sessionId),
            ),
          ),
          Match.orElse(() => sessionId),
        ),
        user,
        revision: state.revision + 1,
        target,
        page: privatePage({ target, previous, requestId: state.revision + 1 }),
      };
      // Login resumes failures as typed targets; their original URL remains meaningful.
      const history: Decision["history"] = Match.value(state._tag === "Anonymous").pipe(
        Match.when(true, () =>
          Match.value(target).pipe(
            Match.tag("Matched", ({ destination }) => ({ _tag: "Replace" as const, destination })),
            Match.orElse((target) => ({ _tag: "ReplaceUrl" as const, url: target.original })),
          ),
        ),
        Match.orElse(() => ({ _tag: "Keep" as const })),
      );
      return admit({ state: authenticated, target, history });
    }),
    Match.exhaustive,
  );
};
export const transition = (options: { state: AppState; event: Event }): Decision => {
  const { state, event } = options;
  return Match.value(event).pipe(
    Match.tag("Navigate", ({ destination, mode }) =>
      admit({
        state,
        target: targetOf(destination),
        history: {
          _tag: Match.value(mode).pipe(
            Match.when("push", () => "Push" as const),
            Match.orElse(() => "Replace" as const),
          ),
          destination,
        },
      }),
    ),
    Match.tag("Location", ({ target }) => admit({ state, target, history: { _tag: "Keep" } })),
    Match.tag("Application", ({ event }) =>
      Match.value(event).pipe(
        Match.tag("Auth", ({ event }) => authTransition({ state, event })),
        Match.tag("Reconcile", () => ({
          state,
          history: Match.value(requested(state)).pipe(
            Match.tag("Matched", ({ destination }) => ({ _tag: "Replace" as const, destination })),
            Match.orElse((target) => ({ _tag: "ReplaceUrl" as const, url: target.original })),
          ),
        })),
        Match.tag("RetryProject", () => ({
          state: Match.value(state).pipe(
            Match.tag("Authenticated", (state) => ({
              ...state,
              revision: state.revision + 1,
              page: privatePage({
                target: state.target,
                previous: Option.none(),
                requestId: state.revision + 1,
              }),
            })),
            Match.orElse((state) => state),
          ),
          history: { _tag: "Keep" as const },
        })),
        Match.tag("ProjectFinished", (event) => ({
          state: completeProject({ state, event }),
          history: { _tag: "Keep" as const },
        })),
        Match.exhaustive,
      ),
    ),
    Match.exhaustive,
  );
};
