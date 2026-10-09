import { Effect, Option } from "effect";
import { branch, cases } from "~/branch";
import { component, provideContext } from "~/component";
import { focus } from "~/focus";
import * as Sync from "~/sync";
import { CurrentProject, Navigation, ProjectIdentity, SessionIdentity } from "./context";
import type { ProjectPage, ProjectState, ProjectsPage } from "./model";
import { MockProjects } from "./resources";
import { ProjectId, projectDestination } from "./routes";
import { button, counter, message, routeLink } from "./ui";

const Overview = branch<Extract<ProjectPage, { _tag: "Overview" }>>()(({ context, inputs }) =>
  Sync.gen(function* () {
    const project = yield* Sync.service(CurrentProject);
    const title = yield* context.derive({
      sources: { project },
      compute: ({ project }) => `${project.name} overview`,
    });
    const edits = yield* focus({ context, source: inputs.state, key: "edits" });
    const value = yield* context.derive({
      sources: { edits },
      compute: ({ edits }) => `Overview edits: ${edits}`,
    });
    const output = yield* context.he("article", {
      children: [
        yield* context.he("h4", { children: [title] }),
        yield* context.he("output", { children: [value] }),
        yield* button(context, { label: "Edit overview", action: edits.update((n) => n + 1) }),
      ],
    });
    return { setup: () => Effect.succeed(output) };
  }),
);

const Settings = branch<Extract<ProjectPage, { _tag: "Settings" }>>()(({ context, inputs }) =>
  Sync.gen(function* () {
    const project = yield* Sync.service(CurrentProject);
    const title = yield* context.derive({
      sources: { project },
      compute: ({ project }) => `${project.name} settings`,
    });
    const note = yield* focus({ context, source: inputs.state, key: "note" });
    const input = yield* context.he("input", {
      props: { type: "text", placeholder: "Project note" },
      attrs: { "aria-label": Option.some("Project note") },
    });
    yield* context.bindValue({ element: input, signal: note });
    const output = yield* context.he("article", {
      children: [
        yield* context.he("h4", { children: [title] }),
        input,
        yield* context.he("output", { children: [note] }),
      ],
    });
    return { setup: () => Effect.succeed(output) };
  }),
);

const MissingChild = branch<Extract<ProjectPage, { _tag: "NotFound" }>>()(({ context, inputs }) =>
  Sync.gen(function* () {
    const label = yield* context.derive({
      sources: { state: inputs.state },
      compute: ({ state }) => `Project child not found: ${state.remainder.join("/")}`,
    });
    const output = yield* context.he("p", { children: [label] });
    return { setup: () => Effect.succeed(output) };
  }),
);

const InvalidChild = branch<Extract<ProjectPage, { _tag: "InvalidUrl" }>>()(({ context }) =>
  Sync.gen(function* () {
    const output = yield* message(context, "Invalid URL within this project");
    return { setup: () => Effect.succeed(output) };
  }),
);

const Ready = branch<Extract<ProjectState, { _tag: "Ready" }>>()(({ context, inputs }) =>
  Sync.gen(function* () {
    const project = yield* context.derive({
      sources: { state: inputs.state },
      compute: ({ state }) => state.project,
    });
    const page = yield* focus({ context, source: inputs.state, key: "page" });
    const shell = component((context) =>
      Sync.gen(function* () {
        const project = yield* Sync.service(CurrentProject);
        const snapshot = yield* context.read(project);
        const output = yield* context.he("section", {
          attrs: { "aria-label": Option.some("Project shell") },
          children: [
            yield* context.he("h3", { children: [snapshot.name] }),
            yield* counter(context, "project shell"),
            yield* context.he("nav", {
              children: [
                yield* routeLink(context, {
                  label: "Overview",
                  destination: projectDestination({ id: snapshot.id }),
                }),
                yield* routeLink(context, {
                  label: "Settings",
                  destination: projectDestination({ id: snapshot.id, settings: true }),
                }),
              ],
            }),
            cases({
              state: page,
              branches: {
                Overview: { branch: Overview },
                Settings: { branch: Settings },
                NotFound: { branch: MissingChild },
                InvalidUrl: { branch: InvalidChild },
              },
            }),
          ],
        });
        return { setup: () => Effect.succeed(output) };
      }),
    );
    return {
      setup: () =>
        Effect.succeed(provideContext({ key: CurrentProject, value: project, child: shell })),
    };
  }),
);

const Loading = branch<Extract<ProjectState, { _tag: "Loading" }>>()(({ context, inputs }) =>
  Sync.gen(function* () {
    const sessionId = yield* Sync.service(SessionIdentity);
    const { id } = yield* Sync.service(ProjectIdentity);
    const navigator = yield* Sync.service(Navigation);
    const { requestId } = yield* context.read(inputs.state);
    return {
      fallback: (context) => message(context, `Acquiring project ${id}…`),
      setup: () =>
        Effect.gen(function* () {
          const projects = yield* MockProjects;
          const result = yield* projects.acquire(id).pipe(
            Effect.match({
              onFailure: ({ message }) => ({ _tag: "Failure" as const, message }),
              onSuccess: (project) => ({ _tag: "Success" as const, project }),
            }),
          );
          yield* navigator.dispatch({
            _tag: "ProjectFinished",
            sessionId,
            projectId: id,
            requestId,
            result,
          });
          return [];
        }),
    };
  }),
);

const Failed = branch<Extract<ProjectState, { _tag: "Failed" }>>()(({ context, inputs }) =>
  Sync.gen(function* () {
    const navigation = yield* Sync.service(Navigation);
    const label = yield* context.derive({
      sources: { state: inputs.state },
      compute: ({ state }) => state.message,
    });
    const output = yield* context.he("div", {
      children: [
        yield* context.he("p", { attrs: { role: Option.some("alert") }, children: [label] }),
        yield* button(context, {
          label: "Retry project",
          action: navigation.dispatch({ _tag: "RetryProject" }),
        }),
      ],
    });
    return { setup: () => Effect.succeed(output) };
  }),
);
export const ProjectBranch = branch<Extract<ProjectsPage, { _tag: "Project" }>>()(
  ({ context, inputs }) =>
    Sync.gen(function* () {
      const { projectId: id } = yield* context.read(inputs.state);
      const state = yield* focus({ context, source: inputs.state, key: "state" });
      const child = component(() =>
        Sync.succeed({
          setup: () =>
            Effect.succeed(
              cases({
                state,
                branches: {
                  Loading: { branch: Loading },
                  Failed: { branch: Failed },
                  Ready: { branch: Ready },
                },
              }),
            ),
        }),
      );
      return {
        setup: () => Effect.succeed(provideContext({ key: ProjectIdentity, value: { id }, child })),
      };
    }),
);
export const ProjectIndex = branch<Extract<ProjectsPage, { _tag: "Index" }>>()(({ context }) =>
  Sync.gen(function* () {
    const output = yield* context.he("div", {
      children: [
        yield* message(context, "Projects index"),
        ...(yield* Sync.gen(function* () {
          const links = [];
          for (const raw of ["123", "456"]) {
            const id = ProjectId.make(Number(raw));
            links.push(
              yield* routeLink(context, {
                label: `Project ${id}`,
                destination: projectDestination({ id }),
              }),
            );
          }
          return links;
        })),
      ],
    });
    return { setup: () => Effect.succeed(output) };
  }),
);
export const InvalidProject = branch<Extract<ProjectsPage, { _tag: "InvalidUrl" }>>()(
  ({ context }) =>
    Sync.gen(function* () {
      const output = yield* message(context, "Invalid project URL: no project was acquired");
      return { setup: () => Effect.succeed(output) };
    }),
);
export const MissingProject = branch<Extract<ProjectsPage, { _tag: "NotFound" }>>()(({ context }) =>
  Sync.gen(function* () {
    const output = yield* message(context, "Projects path not found");
    return { setup: () => Effect.succeed(output) };
  }),
);
