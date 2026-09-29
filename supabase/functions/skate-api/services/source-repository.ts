import { Context, Effect } from "effect";
import {
  Source,
  SourceChanged,
  SourceFailure,
  SourceId,
  SourceNotFound,
} from "../domain/source.ts";

export interface SessionWrite {
  readonly start: string;
  readonly end: string;
  readonly audience: "general" | "family" | "adult" | "children" | "senior";
  readonly isCancelled: boolean;
  readonly certainty: "certain" | "uncertain";
}

export interface PersistenceSummary {
  readonly inserted: number;
  readonly updated: number;
  readonly unchanged: number;
  readonly missingMarkedUncertain: number;
  readonly lastFetched: string;
}

export interface Interface {
  readonly find: (
    id: SourceId,
  ) => Effect.Effect<Source, SourceNotFound | SourceFailure>;
  readonly persist: (
    source: Source,
    completedAt: string,
    sessions: ReadonlyArray<SessionWrite>,
    resolvedDays: ReadonlyArray<string>,
  ) => Effect.Effect<PersistenceSummary, SourceChanged | SourceFailure>;
}

export class Service
  extends Context.Service<Service, Interface>()("SkateApi/SourceRepository") {}
export * as SourceRepository from "./source-repository.ts";
