import { Deferred, Effect, Exit, Layer, Match, Option, Result, Scope } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { component, mounting } from "~/framework";
import { History, memoryHistory } from "~/history";
import * as Sync from "~/sync";
import { rendered } from "~/test-helpers";
import { RoutingDemo } from "./app";
import { MockAuth, MockProjects, mockResources } from "./resources";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of cleanups.splice(0)) await close();
});

const fixture = async (initial: string) => {
  const scope = await Effect.runPromise(Scope.make());
  cleanups.push(() => Effect.runPromise(Scope.close(scope, Exit.void)));
  const history = await Effect.runPromise(
    memoryHistory({ initial }).pipe(Effect.provideService(Scope.Scope, scope)),
  );
  const ready = Deferred.makeUnsafe<{
    auth: Effect.Success<typeof MockAuth>;
    projects: Effect.Success<typeof MockProjects>;
  }>();
  const failures: unknown[] = [];

  const app = await Effect.runPromise(
    mounting({
      scope,
      resources: Layer.mergeAll(Layer.succeed(History, history), mockResources),
      onError: (failure) => {
        failures.push(failure);
      },
    }),
  );
  const parent = document.createElement("div");
  Effect.runSync(
    app.h(
      parent,
      component(() =>
        Sync.succeed({
          setup: () =>
            Effect.gen(function* () {
              const auth = yield* MockAuth;
              const projects = yield* MockProjects;
              yield* Deferred.succeed(ready, { auth, projects });
              return RoutingDemo;
            }),
        }),
      ),
    ),
  );

  const resources = await Effect.runPromise(Deferred.await(ready));
  const shows = (text: string) =>
    rendered({ parent, check: () => parent.textContent?.includes(text) === true });
  const press = (label: string) => {
    const node = [...parent.querySelectorAll("button, a")].find(
      (node) => node.textContent === label,
    );
    expect(node, `Missing control ${label}; failures: ${failures.length}`).toBeDefined();
    node?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  };
  await shows("Resolving session");
  return { parent, history, shows, press, failures, ...resources };
};

describe("mock nested routing application", () => {
  it("resumes a private deep link after discovery/login and retains eligible shell state", async () => {
    const f = await fixture("/routing/projects/123/settings");
    expect(f.parent.querySelector('[aria-label="Authenticated shell"]')).toBeNull();
    await Effect.runPromise(f.auth.resolve(Option.none()));
    await f.shows("Sign in to resume");
    expect(f.history.location()).toBe("/routing/login");
    f.press("Sign in as Ada");
    await f.shows("Project 123 settings");
    expect(f.history.location()).toBe("/routing/projects/123/settings");
    f.press("Increment authenticated shell");
    await f.shows("authenticated shell: 1");
    f.press("Increment project shell");
    await f.shows("project shell: 1");
    const input = f.parent.querySelector<HTMLInputElement>('input[aria-label="Project note"]');
    expect(input).not.toBeNull();
    Match.value(input).pipe(
      Match.when(
        (node): node is HTMLInputElement => node !== null,
        (node) => {
          node.value = "live note";
          node.dispatchEvent(new Event("input", { bubbles: true }));
        },
      ),
      Match.orElse(() => {}),
    );
    await f.shows("live note");
    f.press("Overview");
    await f.shows("Project 123 overview");
    expect(f.parent.textContent).toContain("authenticated shell: 1");
    expect(f.parent.textContent).toContain("project shell: 1");
    f.press("Dashboard");
    await f.shows("Dashboard for Ada");
    expect(f.parent.textContent).toContain("authenticated shell: 1");
    await Effect.runPromise(f.auth.refresh);
    expect(f.parent.textContent).toContain("authenticated shell: 1");
    await Effect.runPromise(f.auth.signIn({ name: "Ada" }));
    await f.shows("Dashboard for Ada");
    expect(f.parent.textContent).toContain("authenticated shell: 1");
    await Effect.runPromise(f.auth.signIn({ name: "Grace" }));
    await f.shows("Dashboard for Grace");
    expect(f.parent.textContent).toContain("authenticated shell: 0");
    expect(f.failures).toEqual([]);
  });

  it("defers malformed private URLs without acquiring a project and restores their URL after login", async () => {
    const f = await fixture("/routing/projects/wrong-id");
    await Effect.runPromise(f.auth.resolve(Option.none()));
    await f.shows("Sign in to resume");
    expect(f.history.location()).toBe("/routing/login");
    await Effect.runPromise(f.auth.signIn({ name: "Ada" }));
    await f.shows("Invalid project URL");
    expect(f.history.location()).toBe("/routing/projects/wrong-id");
    expect(f.parent.querySelector('[aria-label="Projects shell"]')).not.toBeNull();
    expect(f.parent.querySelector('[aria-label="Project shell"]')).toBeNull();
    expect(f.parent.textContent).toContain("Pending project acquisitions: 0");
    expect(f.failures).toEqual([]);
  });

  it("cancels delayed projects on replacement, retains pending work through tab changes, and renders nested errors", async () => {
    const f = await fixture("/routing/projects/123/doesnt-exist");
    await Effect.runPromise(f.projects.mode("Delayed"));
    await Effect.runPromise(f.auth.resolve(Option.some({ name: "Ada" })));
    await f.shows("Acquiring project 123");
    await f.shows("Pending project acquisitions: 1");
    await Effect.runPromise(f.projects.complete(true));
    await f.shows("Project child not found: doesnt-exist");
    expect(f.parent.querySelector('[aria-label="Project shell"]')).not.toBeNull();
    f.press("Projects index");
    await f.shows("Projects indexProject 123Project 456");
    f.press("Project 123");
    await f.shows("Acquiring project 123");
    await f.shows("Pending project acquisitions: 1");
    f.press("Private deep link: project 123 settings");
    expect(f.parent.textContent).toContain("Acquiring project 123");
    expect(f.parent.textContent).toContain("Pending project acquisitions: 1");
    await Effect.runPromise(f.projects.complete(true));
    await f.shows("Project 123 settings");
    f.press("Projects index");
    await f.shows("Projects indexProject 123Project 456");
    f.press("Project 123");
    await f.shows("Acquiring project 123");
    f.press("Dashboard");
    await f.shows("Dashboard for Ada");
    await f.shows("Pending project acquisitions: 0");
    await Effect.runPromise(f.projects.complete(true));
    expect(f.parent.textContent).not.toContain("Project 123 overview");
    expect(f.failures).toEqual([]);
  });
});

it("keeps the page on rejected history writes and reconciles a denied traversal explicitly", async () => {
  const f = await fixture("/routing/projects/123/settings");
  await Effect.runPromise(f.auth.resolve(Option.some({ name: "Ada" })));
  await f.shows("Project 123 settings");
  f.history.failNextWrite("reject dashboard");
  f.press("Dashboard");
  await f.shows("history: navigation failed");
  expect(f.history.location()).toBe("/routing/projects/123/settings");
  expect(f.parent.textContent).toContain("Project 123 settings");
  f.press("Dashboard");
  await f.shows("Dashboard for Ada");
  await Effect.runPromise(f.auth.logout);
  await f.shows("Sign in to resume");
  f.history.failNextWrite("reject denied traversal redirect");
  Result.getOrThrow(f.history.traverse(-1));
  await f.shows("traversal: navigation failed");
  expect(f.history.location()).toBe("/routing/projects/123/settings");
  expect(f.parent.querySelector('[aria-label="Authenticated shell"]')).toBeNull();
  f.press("Reconcile URL");
  await rendered({
    parent: f.parent,
    check: () =>
      f.history.location() === "/routing/login" &&
      !f.parent.textContent?.includes("navigation failed"),
  });
  expect(f.failures).toEqual([]);
});

it("resets project ownership on direct project changes and separates acquisition failures from URL errors", async () => {
  const f = await fixture("/routing/projects/123");
  await Effect.runPromise(f.projects.mode("Failed"));
  await Effect.runPromise(f.auth.resolve(Option.some({ name: "Ada" })));
  await f.shows("Project 123 could not be acquired");
  expect(f.history.location()).toBe("/routing/projects/123");
  await Effect.runPromise(f.projects.mode("Immediate"));
  f.press("Retry project");
  await f.shows("Project 123 overview");
  f.press("Increment project shell");
  await f.shows("project shell: 1");
  f.press("Project 456 overview");
  await f.shows("Project 456 overview");
  await f.shows("project shell: 0");
  await Effect.runPromise(f.auth.expire);
  await f.shows("Sign in to resume");
  expect(f.history.location()).toBe("/routing/login");
  expect(f.parent.querySelector('[aria-label="Project shell"]')).toBeNull();
  await Effect.runPromise(f.auth.signIn({ name: "Grace" }));
  await f.shows("Signed in as Grace");
  await f.shows("Project 456 overview");
  expect(f.history.location()).toBe("/routing/projects/456");
  expect(f.failures).toEqual([]);
});
