import { Match, Option } from "effect";
import { expect, it } from "vitest";
import type { AppEvent, AppState } from "./model";
import { ProjectId, projectDestination, urls } from "./routes";
import { transition } from "./transitions";

const initial = (url: string): AppState => ({
  _tag: "ResolvingSession",
  requested: urls.parse(url),
  revision: 0,
});

const event = (options: { state: AppState; event: AppEvent }) =>
  transition({ state: options.state, event: { _tag: "Application", event: options.event } }).state;

const session = (state: AppState) =>
  event({
    state,
    event: {
      _tag: "Auth",
      event: { _tag: "Session", sessionId: "session", user: { name: "Ada" } },
    },
  });

const loading = (state: AppState) => {
  const app = Match.value(state).pipe(
    Match.tag("Authenticated", (app) => app),
    Match.orElse(() => {
      throw new Error("Expected authentication");
    }),
  );
  const projects = Match.value(app.page).pipe(
    Match.tag("Projects", (projects) => projects),
    Match.orElse(() => {
      throw new Error("Expected projects");
    }),
  );
  const project = Match.value(projects.page).pipe(
    Match.tag("Project", (project) => project),
    Match.orElse(() => {
      throw new Error("Expected project");
    }),
  );
  return Match.value(project.state).pipe(
    Match.tag("Loading", (loading) => loading),
    Match.orElse(() => {
      throw new Error("Expected loading");
    }),
  );
};

it("preserves pending return targets across repeated anonymous discovery and clears them on logout", () => {
  const discover: AppEvent = { _tag: "Auth", event: { _tag: "Ended", reason: "discovery" } };
  const first = event({ state: initial("/projects/123/settings"), event: discover });
  const repeated = event({ state: first, event: discover });
  const signedIn = session(repeated);
  expect(signedIn).toMatchObject({
    _tag: "Authenticated",
    page: { _tag: "Projects", page: { projectId: 123 } },
  });
  const logout = event({
    state: repeated,
    event: { _tag: "Auth", event: { _tag: "Ended", reason: "logout" } },
  });
  expect(logout).toMatchObject({ _tag: "Anonymous", returnTo: Option.none() });
  expect(session(logout)).toMatchObject({ _tag: "Authenticated", page: { _tag: "Dashboard" } });
  // A fresh application state carries only its observed URL.
  expect(session(initial("/login"))).toMatchObject({
    _tag: "Authenticated",
    page: { _tag: "Dashboard" },
  });
});

it("updates nested unknown remainders without discarding the acquired project", () => {
  const id = ProjectId.make(123);
  const acquiring = session(initial("/projects/123/first"));
  const ready = event({
    state: acquiring,
    event: {
      _tag: "ProjectFinished",
      sessionId: "session",
      projectId: id,
      requestId: loading(acquiring).requestId,
      result: { _tag: "Success", project: { id, name: "Project 123" } },
    },
  });
  const next = transition({
    state: ready,
    event: {
      _tag: "Location",
      observed: "/projects/123/second",
      target: urls.parse("/projects/123/second"),
      initial: false,
    },
  });
  expect(next.state).toMatchObject({
    _tag: "Authenticated",
    page: {
      page: {
        state: {
          _tag: "Ready",
          project: { id: 123 },
          page: { _tag: "NotFound", remainder: ["second"] },
        },
      },
    },
  });
});

it("ignores obsolete project completions by session, project and request identity", () => {
  const id = ProjectId.make(123);
  const state = session(initial("/projects/123"));
  const requestId = loading(state).requestId;
  for (const identity of [
    { sessionId: "obsolete", projectId: id, requestId },
    { sessionId: "session", projectId: ProjectId.make(456), requestId },
    { sessionId: "session", projectId: id, requestId: requestId - 1 },
  ]) {
    expect(
      event({
        state,
        event: {
          _tag: "ProjectFinished",
          ...identity,
          result: { _tag: "Success", project: { id, name: "obsolete" } },
        },
      }),
    ).toBe(state);
  }
  const redirected = transition({
    state,
    event: {
      _tag: "Navigate",
      destination: projectDestination({ id: ProjectId.make(456) }),
      mode: "push",
    },
  }).state;
  expect(
    event({
      state: redirected,
      event: {
        _tag: "ProjectFinished",
        sessionId: "session",
        projectId: id,
        requestId,
        result: { _tag: "Failure", message: "obsolete" },
      },
    }),
  ).toBe(redirected);
});

it("preserves acquired project state for the same account and resets it for another account", () => {
  const id = ProjectId.make(123);
  const acquiring = session(initial("/projects/123/settings"));
  const ready = event({
    state: acquiring,
    event: {
      _tag: "ProjectFinished",
      sessionId: "session",
      projectId: id,
      requestId: loading(acquiring).requestId,
      result: { _tag: "Success", project: { id, name: "Project 123" } },
    },
  });
  const updated = event({
    state: ready,
    event: {
      _tag: "Auth",
      event: { _tag: "Session", sessionId: "new-session", user: { name: "Ada" } },
    },
  });
  expect(updated).toMatchObject({
    _tag: "Authenticated",
    sessionId: "session",
    page: { page: { state: { _tag: "Ready", project: { id }, page: { _tag: "Settings" } } } },
  });
  const switched = event({
    state: updated,
    event: {
      _tag: "Auth",
      event: { _tag: "Session", sessionId: "other-session", user: { name: "Grace" } },
    },
  });
  expect(switched).toMatchObject({
    _tag: "Authenticated",
    sessionId: "other-session",
    page: { page: { state: { _tag: "Loading" } } },
  });
});
