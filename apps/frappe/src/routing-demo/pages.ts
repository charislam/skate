import { Match, Option } from "effect";
import type { PrivatePage, ProjectChild, ProjectPage, ProjectsPage, PublicPage } from "./model";
import type { NavigationTarget, ProjectId } from "./routes";

export const childPage = (options: {
  target: ProjectChild;
  previous: Option.Option<ProjectPage>;
}): ProjectPage =>
  Option.getOrElse(
    Option.filter(
      options.previous,
      (page) =>
        page._tag === options.target._tag && (page._tag === "Overview" || page._tag === "Settings"),
    ),
    () =>
      Match.value(options.target).pipe(
        Match.tag("Overview", () => ({ _tag: "Overview" as const, edits: 0 })),
        Match.tag("Settings", () => ({ _tag: "Settings" as const, note: "" })),
        Match.tag("NotFound", ({ remainder }) => ({ _tag: "NotFound" as const, remainder })),
        Match.tag("InvalidUrl", ({ issue }) => ({ _tag: "InvalidUrl" as const, issue })),
        Match.exhaustive,
      ),
  );

const projectPage = (options: {
  id: ProjectId;
  child: ProjectChild;
  previous: Option.Option<ProjectsPage>;
  requestId: number;
}): ProjectsPage => {
  const previous = Option.flatMap(options.previous, (page) =>
    Match.value(page).pipe(
      Match.tag("Project", (page) =>
        Option.filter(Option.some(page), (page) => page.projectId === options.id),
      ),
      Match.orElse(() => Option.none()),
    ),
  );
  return {
    _tag: "Project",
    projectId: options.id,
    state: Option.match(previous, {
      onNone: () => ({ _tag: "Loading", requested: options.child, requestId: options.requestId }),
      onSome: ({ state }) =>
        Match.value(state).pipe(
          Match.tag("Loading", (state) => ({ ...state, requested: options.child })),
          Match.tag("Failed", (state) => ({ ...state, requested: options.child })),
          Match.tag("Ready", ({ project, page }) => ({
            _tag: "Ready" as const,
            project,
            page: childPage({ target: options.child, previous: Option.some(page) }),
          })),
          Match.exhaustive,
        ),
    }),
  };
};

export const privatePage = (options: {
  target: NavigationTarget;
  previous: Option.Option<PrivatePage>;
  requestId: number;
}): PrivatePage => {
  const previousProjects = Option.flatMap(options.previous, (page) =>
    Match.value(page).pipe(
      Match.tag("Projects", ({ page }) => Option.some(page)),
      Match.orElse(() => Option.none()),
    ),
  );
  const projects = (page: ProjectsPage): PrivatePage => ({ _tag: "Projects", page });
  return Match.value(options.target).pipe(
    Match.tag("Matched", ({ destination }) =>
      Match.value(destination).pipe(
        Match.tag("Login", "Dashboard", () => ({ _tag: "Dashboard" as const })),
        Match.tag("Projects", () => projects({ _tag: "Index" })),
        Match.tag("Project", "Settings", (destination) =>
          projects(
            projectPage({
              id: destination.params.projectId,
              child: Match.value(destination._tag).pipe(
                Match.when("Project", () => ({ _tag: "Overview" as const })),
                Match.orElse(() => ({ _tag: "Settings" as const })),
              ),
              previous: previousProjects,
              requestId: options.requestId,
            }),
          ),
        ),
        Match.exhaustive,
      ),
    ),
    Match.orElse((target) => {
      const id = target.ancestry.reduce<Option.Option<ProjectId>>(
        (id, prefix) =>
          Match.value(prefix).pipe(
            Match.tag("Project", "Settings", ({ params }) => Option.some(params.projectId)),
            Match.orElse(() => id),
          ),
        Option.none(),
      );
      return Option.match(id, {
        onSome: (id) =>
          projects(
            projectPage({
              id,
              child: Match.value(target).pipe(
                Match.tag("NotFound", ({ remainder }) => ({
                  _tag: "NotFound" as const,
                  remainder,
                })),
                Match.tag("InvalidUrl", ({ issue }) => ({ _tag: "InvalidUrl" as const, issue })),
                Match.exhaustive,
              ),
              previous: previousProjects,
              requestId: options.requestId,
            }),
          ),
        onNone: () =>
          Match.value(target).pipe(
            Match.tag("InvalidUrl", ({ issue, ancestry }) =>
              Match.value(ancestry.some((prefix) => prefix._tag === "Projects")).pipe(
                Match.when(true, () => projects({ _tag: "InvalidUrl", issue })),
                Match.orElse(() => ({ _tag: "InvalidUrl" as const, issue })),
              ),
            ),
            Match.tag("NotFound", ({ remainder, ancestry }) =>
              Match.value(ancestry.some((prefix) => prefix._tag === "Projects")).pipe(
                Match.when(true, () => projects({ _tag: "NotFound", remainder })),
                Match.orElse(() => ({ _tag: "NotFound" as const, remainder })),
              ),
            ),
            Match.exhaustive,
          ),
      });
    }),
  );
};

export const publicPage = (target: NavigationTarget): PublicPage =>
  Match.value(target).pipe(
    Match.tag("Matched", () => ({ _tag: "Login" as const })),
    Match.tag("NotFound", ({ remainder }) => ({ _tag: "NotFound" as const, remainder })),
    Match.tag("InvalidUrl", ({ issue }) => ({ _tag: "InvalidUrl" as const, issue })),
    Match.exhaustive,
  );
