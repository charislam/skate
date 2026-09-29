import { Schema } from "effect";

export const SourceId = Schema.String.pipe(
  Schema.brand("SourceId"),
);
export type SourceId = typeof SourceId.Type;

export const Source = Schema.Struct({
  id: SourceId,
  name: Schema.String,
  type: Schema.String,
  url: Schema.String,
  notes: Schema.NullOr(Schema.String),
  rinkId: Schema.String,
  enabled: Schema.Boolean,
  updatedAt: Schema.String,
});
export interface Source extends Schema.Schema.Type<typeof Source> {}

export class SourceNotFound
  extends Schema.TaggedError<SourceNotFound>()("SourceNotFound", {
    sourceId: SourceId,
    cause: Schema.String,
  }) {}
export class SourceDisabled
  extends Schema.TaggedError<SourceDisabled>()("SourceDisabled", {
    sourceId: SourceId,
    cause: Schema.String,
  }) {}
export class UnsupportedSourceType
  extends Schema.TaggedError<UnsupportedSourceType>()("UnsupportedSourceType", {
    sourceType: Schema.String,
    cause: Schema.String,
  }) {}
export class SourceChanged
  extends Schema.TaggedError<SourceChanged>()("SourceChanged", {
    sourceId: SourceId,
    cause: Schema.String,
  }) {}
export class SourceFailure
  extends Schema.TaggedError<SourceFailure>()("SourceFailure", {
    operation: Schema.String,
    cause: Schema.String,
  }) {}
export class SourceContentTooLarge
  extends Schema.TaggedError<SourceContentTooLarge>()(
    "SourceContentTooLarge",
    { cause: Schema.String },
  ) {}
export class UnsafeSourceUrl
  extends Schema.TaggedError<UnsafeSourceUrl>()("UnsafeSourceUrl", {
    cause: Schema.String,
  }) {}
