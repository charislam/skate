import { Context, Effect, Schema } from "effect";

export const Question = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("choice"),
    instructions: Schema.String,
    options: Schema.Record(Schema.String, Schema.String),
  }),
  Schema.Struct({ type: Schema.Literal("noul"), instructions: Schema.String }),
]);
export type Question = Schema.Schema.Type<typeof Question>;
export const Answer = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("choice"),
    choice: Schema.String,
    probabilities: Schema.Record(Schema.String, Schema.Number),
    confidence: Schema.Number,
  }),
  Schema.Struct({ type: Schema.Literal("noul"), noul: Schema.Number }),
]);
export type Answer = Schema.Schema.Type<typeof Answer>;
export const Classification = Schema.Struct({
  answers: Schema.Record(Schema.String, Answer),
  providerModel: Schema.String,
  usage: Schema.Struct({
    inputTokens: Schema.Number,
    outputTokens: Schema.Number,
  }),
});
export interface Classification
  extends Schema.Schema.Type<typeof Classification> {}
export interface ClassifierState {
  readonly rink_info: string;
  readonly instructions: string;
  readonly additional_notes: string;
}
export class ClassifierFailure
  extends Schema.TaggedError<ClassifierFailure>()("ClassifierFailure", {
    status: Schema.Number,
    operation: Schema.String,
    cause: Schema.String,
  }) {}
export class ClassifierOverloaded
  extends Schema.TaggedError<ClassifierOverloaded>()("ClassifierOverloaded", {
    operation: Schema.String,
    retryAfterMs: Schema.Number,
    cause: Schema.String,
  }) {}

export interface Interface {
  readonly classify: (
    state: ClassifierState,
    questions: Readonly<Record<string, Question>>,
  ) => Effect.Effect<
    Classification,
    ClassifierFailure | ClassifierOverloaded
  >;
  readonly model: string;
}
export class Service
  extends Context.Service<Service, Interface>()("SkateApi/ClassifierService") {}
export * as Classifier from "./classifier.ts";
