import { Match, Option } from "effect";
import type { AppEvent, AppState, ProjectState } from "./model";
import { childPage } from "./pages";

/** Work that outlives a page must carry and recheck all three identities. */
export const completeProject = (options: {
  state: AppState;
  event: Extract<AppEvent, { _tag: "ProjectFinished" }>;
}): AppState => {
  const { state, event } = options;
  const occurrence = Match.value(state).pipe(
    Match.tag("Authenticated", (app) =>
      Match.value(app.page).pipe(
        Match.tag("Projects", (projects) =>
          Match.value(projects.page).pipe(
            Match.tag("Project", (page) =>
              Match.value(page.state).pipe(
                Match.tag("Loading", (loading) => Option.some({ app, projects, page, loading })),
                Match.orElse(() => Option.none()),
              ),
            ),
            Match.orElse(() => Option.none()),
          ),
        ),
        Match.orElse(() => Option.none()),
      ),
    ),
    Match.orElse(() => Option.none()),
  );
  return Option.match(
    Option.filter(
      occurrence,
      ({ app, page, loading }) =>
        app.sessionId === event.sessionId &&
        page.projectId === event.projectId &&
        loading.requestId === event.requestId,
    ),
    {
      onNone: () => state,
      onSome: ({ app, projects, page, loading }) => {
        const completed: ProjectState = Match.value(event.result).pipe(
          Match.tag("Success", ({ project }) => ({
            _tag: "Ready" as const,
            project,
            page: childPage({ target: loading.requested, previous: Option.none() }),
          })),
          Match.tag("Failure", ({ message }) => ({
            _tag: "Failed" as const,
            message,
            requested: loading.requested,
          })),
          Match.exhaustive,
        );
        return { ...app, page: { ...projects, page: { ...page, state: completed } } };
      },
    },
  );
};
