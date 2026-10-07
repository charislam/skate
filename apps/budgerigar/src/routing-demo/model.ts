import { Data, Option } from "effect";
import type { UrlIssue } from "~/routes";
import type { NavigationTarget, ProjectId } from "./routes";

export interface User {
  readonly name: string;
}
export interface Project {
  readonly id: ProjectId;
  readonly name: string;
}
export type ProjectChild = Data.TaggedEnum<{
  Overview: {};
  Settings: {};
  NotFound: { readonly remainder: ReadonlyArray<string> };
  InvalidUrl: { readonly issue: UrlIssue };
}>;
export type ProjectPage = Data.TaggedEnum<{
  Overview: { readonly edits: number };
  Settings: { readonly note: string };
  NotFound: { readonly remainder: ReadonlyArray<string> };
  InvalidUrl: { readonly issue: UrlIssue };
}>;
export type ProjectState = Data.TaggedEnum<{
  Loading: { readonly requested: ProjectChild; readonly requestId: number };
  Failed: { readonly message: string; readonly requested: ProjectChild };
  Ready: { readonly project: Project; readonly page: ProjectPage };
}>;
export type ProjectsPage = Data.TaggedEnum<{
  Index: {};
  InvalidUrl: { readonly issue: UrlIssue };
  NotFound: { readonly remainder: ReadonlyArray<string> };
  Project: { readonly projectId: ProjectId; readonly state: ProjectState };
}>;
export type PrivatePage = Data.TaggedEnum<{
  Dashboard: {};
  InvalidUrl: { readonly issue: UrlIssue };
  Projects: { readonly page: ProjectsPage };
  NotFound: { readonly remainder: ReadonlyArray<string> };
}>;
export type PublicPage = Data.TaggedEnum<{
  Login: {};
  NotFound: { readonly remainder: ReadonlyArray<string> };
  InvalidUrl: { readonly issue: UrlIssue };
}>;
export type AppState = Data.TaggedEnum<{
  ResolvingSession: { readonly requested: NavigationTarget; readonly revision: number };
  Anonymous: {
    readonly page: PublicPage;
    readonly returnTo: Option.Option<NavigationTarget>;
    readonly target: NavigationTarget;
    readonly revision: number;
  };
  Authenticated: {
    readonly sessionId: string;
    readonly user: User;
    readonly page: PrivatePage;
    readonly target: NavigationTarget;
    readonly revision: number;
  };
}>;
export type AuthEvent = Data.TaggedEnum<{
  Pending: {};
  Session: { readonly sessionId: string; readonly user: User };
  Ended: { readonly reason: "discovery" | "expiry" | "logout" };
}>;
export type AppEvent = Data.TaggedEnum<{
  Auth: { readonly event: AuthEvent };
  ProjectFinished: {
    readonly sessionId: string;
    readonly projectId: ProjectId;
    readonly requestId: number;
    readonly result: Data.TaggedEnum<{
      Success: { readonly project: Project };
      Failure: { readonly message: string };
    }>;
  };
  RetryProject: {};
  Reconcile: {};
}>;
