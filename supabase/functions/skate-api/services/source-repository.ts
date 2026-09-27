import { Context, Effect } from "effect";
import {
  Source,
  SourceChanged,
  SourceFailure,
  SourceId,
  SourceNotFound,
} from "../domain/source.ts";

export interface Interface {
  readonly find: (
    id: SourceId,
  ) => Effect.Effect<Source, SourceNotFound | SourceFailure>;
  readonly complete: (
    source: Source,
    completedAt: string,
  ) => Effect.Effect<string, SourceChanged | SourceFailure>;
}

export class Service
  extends Context.Service<Service, Interface>()("SkateApi/SourceRepository") {}
export * as SourceRepository from "./source-repository.ts";
