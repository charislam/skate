import { Match, Option, Schema } from "effect";
import {
  parameter,
  route,
  router,
  type Destination as InferredDestination,
  type ParseResult,
} from "~/routes";

export const ProjectId = Schema.NumberFromString.pipe(
  Schema.check(Schema.isInt(), Schema.isGreaterThan(0)),
  Schema.brand("DemoProjectId"),
);
export type ProjectId = typeof ProjectId.Type;

export const urls = router([
  route({ tag: "Login", path: ["login"] }),
  route({ tag: "Dashboard", path: [] }),
  route({
    tag: "Projects",
    path: ["projects"],
    children: [
      route({
        tag: "Project",
        path: [parameter("projectId", ProjectId)],
        children: [route({ tag: "Settings", path: ["settings"] })],
      }),
    ],
  }),
]);

export type Destination = InferredDestination<typeof urls.definitions>;
export type NavigationTarget = ParseResult<typeof urls.definitions>;

export const login: Destination = {
  _tag: "Login",
  params: {},
  query: {},
  fragment: Option.none(),
};
export const dashboard: Destination = {
  _tag: "Dashboard",
  params: {},
  query: {},
  fragment: Option.none(),
};
export const projects: Destination = {
  _tag: "Projects",
  params: {},
  query: {},
  fragment: Option.none(),
};
export const projectDestination = (options: {
  id: ProjectId;
  settings?: boolean;
}): Destination => ({
  _tag: Match.value(options.settings === true).pipe(
    Match.when(true, () => "Settings" as const),
    Match.orElse(() => "Project" as const),
  ),
  params: { projectId: options.id },
  query: {},
  fragment: Option.none(),
});
