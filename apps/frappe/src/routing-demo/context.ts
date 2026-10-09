import * as Context from "~/context";
import type { Navigator } from "~/navigation";
import type { Signal } from "~/reactive/signal";
import type { AppEvent, Project, User } from "./model";
import type { urls } from "./routes";

export class Navigation extends Context.Service<
  Navigation,
  Navigator<typeof urls.definitions, AppEvent>
>()("RoutingDemo/Navigation") {}
export class CurrentUser extends Context.Service<CurrentUser, Signal<User>>()(
  "RoutingDemo/CurrentUser",
) {}
export class CurrentProject extends Context.Service<CurrentProject, Signal<Project>>()(
  "RoutingDemo/CurrentProject",
) {}
export class SessionIdentity extends Context.Service<SessionIdentity, string>()(
  "RoutingDemo/SessionIdentity",
) {}
export class ProjectIdentity extends Context.Service<
  ProjectIdentity,
  { readonly id: Project["id"] }
>()("RoutingDemo/ProjectIdentity") {}
