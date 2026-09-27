import { ConfigService } from "../config.ts";
import { describeCause } from "../domain/error-details.ts";
import {
  Classifier,
  ClassifierFailure,
  ClassifierOverloaded,
} from "../services/classifier.ts";
import {
  Cause,
  Clock,
  Effect,
  Layer,
  Redacted,
  Schedule,
  Schema,
} from "effect";
import { Duration } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
} from "effect/unstable/http";

const classifierFailure = (
  status: number,
  operation: string,
  cause: unknown,
) => new ClassifierFailure({ status, operation, cause: describeCause(cause) });

const answerFailureCause = (
  id: string,
  answer: unknown,
  validation: unknown,
) =>
  `answerId=${id}; originalAnswer=${
    describeCause(answer).slice(0, 4_000)
  }; validation=${describeCause(validation).slice(0, 3_000)}`;

const ChoiceAnswer = Schema.Struct({
  type: Schema.Literal("choice"),
  choice: Schema.String,
  probabilities: Schema.Record(Schema.String, Schema.Number),
  confidence: Schema.Number,
});
const NoulAnswer = Schema.Struct({
  type: Schema.Literal("noul"),
  noul: Schema.Number,
});
const ResponseSchema = Schema.Struct({
  model: Schema.String,
  answers: Schema.Record(Schema.String, Schema.Unknown),
  usage: Schema.Struct({
    input_tokens: Schema.Number,
    output_tokens: Schema.Number,
  }),
});

export const jevLayer = Layer.effect(
  Classifier.Service,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const client = yield* HttpClient.HttpClient;
    const classifyAttempt = Effect.fn("ClassifierService.classify")(
      function* (
        state: string,
        questions: Readonly<Record<string, Classifier.Question>>,
      ) {
        const requestQuestions = Object.fromEntries(
          Object.entries(questions).map((
            [id, question],
          ) => [
            id,
            question.type === "choice"
              ? {
                type: "choice",
                instructions: question.instructions,
                criteria: question.options,
              }
              : { type: "noul", instructions: question.instructions },
          ]),
        );
        const request = yield* HttpClientRequest.post(
          "https://api.typesafe.ai/v1/systemone",
        ).pipe(
          HttpClientRequest.bearerToken(Redacted.value(config.typesafeApiKey)),
          HttpClientRequest.bodyJson({
            state,
            model: config.model,
            questions: requestQuestions,
          }),
        );
        const response = yield* client.execute(request).pipe(
          Effect.timeout("30 seconds"),
          Effect.mapError((error) =>
            classifierFailure(
              Cause.isTimeoutError(error) ? 504 : 502,
              Cause.isTimeoutError(error) ? "request_timeout" : "request",
              error,
            )
          ),
        );
        if (response.status === 429 || response.status === 529) {
          const retryAfter = response.headers["retry-after"];
          const retrySeconds = retryAfter === undefined
            ? 0
            : Number(retryAfter);
          const retryDate = retryAfter === undefined
            ? NaN
            : Date.parse(retryAfter);
          const now = yield* Clock.currentTimeMillis;
          const retryAfterMs = Number.isFinite(retrySeconds)
            ? retrySeconds * 1000
            : Number.isFinite(retryDate)
            ? Math.max(0, retryDate - now)
            : 0;
          const responseBody = yield* response.text.pipe(
            Effect.catch((cause) =>
              Effect.succeed(
                `Unable to read Jev error response: ${describeCause(cause)}`,
              )
            ),
            Effect.map((body) => body.slice(0, 2_000)),
          );
          return yield* Effect.fail(
            new ClassifierOverloaded({
              operation: "rate_limited",
              retryAfterMs: Math.min(30_000, Math.max(0, retryAfterMs)),
              cause: `Jev returned HTTP ${response.status}: ${responseBody}`,
            }),
          );
        }
        if (
          !response.status || response.status < 200 || response.status >= 300
        ) {
          const responseBody = yield* response.text.pipe(
            Effect.catch((cause) =>
              Effect.succeed(
                `Unable to read Jev error response: ${describeCause(cause)}`,
              )
            ),
            Effect.map((body) => body.slice(0, 2_000)),
          );
          return yield* Effect.fail(
            classifierFailure(
              response.status,
              "http_response",
              `Jev returned HTTP ${response.status}: ${responseBody}`,
            ),
          );
        }
        const raw = yield* response.json.pipe(
          Effect.mapError((cause) =>
            classifierFailure(502, "decode_json", cause)
          ),
        );
        const decoded = yield* Schema.decodeUnknownEffect(ResponseSchema)(raw)
          .pipe(
            Effect.mapError((cause) =>
              classifierFailure(502, "decode_response", cause)
            ),
          );
        const answers: Record<string, Classifier.Answer> = {};
        for (const [id, question] of Object.entries(questions)) {
          const value = decoded.answers[id];
          if (value === undefined) {
            return yield* Effect.fail(
              classifierFailure(
                502,
                "validate_answers",
                `Jev response omitted answer '${id}'`,
              ),
            );
          }
          if (question.type === "choice") {
            const answer = yield* Schema.decodeUnknownEffect(ChoiceAnswer)(
              value,
            ).pipe(
              Effect.mapError((cause) =>
                classifierFailure(
                  502,
                  "decode_choice_answer",
                  answerFailureCause(id, value, cause),
                )
              ),
            );
            const probabilities = Object.values(answer.probabilities);
            const sum = probabilities.reduce((total, part) => total + part, 0);
            if (
              !(answer.choice in question.options) ||
              Object.keys(answer.probabilities).length !==
                Object.keys(question.options).length ||
              Object.keys(question.options).some((key) =>
                !(key in answer.probabilities)
              ) || probabilities.some((part) =>
                !Number.isFinite(part) || part < 0 || part > 1
              ) || Math.abs(sum - 1) > 0.01 ||
              !Number.isFinite(answer.confidence) || answer.confidence < 0 ||
              answer.confidence > 1
            ) {
              return yield* Effect.fail(classifierFailure(
                502,
                "validate_choice_answer",
                answerFailureCause(
                  id,
                  value,
                  "Unknown choice or invalid probability distribution",
                ),
              ));
            }
            answers[id] = answer;
          } else {
            const answer = yield* Schema.decodeUnknownEffect(NoulAnswer)(value)
              .pipe(
                Effect.mapError((cause) =>
                  classifierFailure(
                    502,
                    "decode_noul_answer",
                    answerFailureCause(id, value, cause),
                  )
                ),
              );
            if (
              !Number.isFinite(answer.noul) || answer.noul < 0 ||
              answer.noul > 1
            ) {
              return yield* Effect.fail(classifierFailure(
                502,
                "validate_noul_answer",
                answerFailureCause(id, value, "Invalid noul probability"),
              ));
            }
            answers[id] = answer;
          }
        }
        if (
          Object.keys(decoded.answers).some((id) => !(id in questions))
        ) {
          return yield* Effect.fail(classifierFailure(
            502,
            "validate_answer_keys",
            "Jev response included answer IDs that were not requested",
          ));
        }
        if (
          !Number.isInteger(decoded.usage.input_tokens) ||
          !Number.isInteger(decoded.usage.output_tokens) ||
          decoded.usage.input_tokens < 0 ||
          decoded.usage.output_tokens < 0
        ) {
          return yield* Effect.fail(classifierFailure(
            502,
            "validate_usage",
            "Jev response token usage must contain non-negative integers",
          ));
        }
        return {
          answers,
          providerModel: decoded.model,
          usage: {
            inputTokens: decoded.usage.input_tokens,
            outputTokens: decoded.usage.output_tokens,
          },
        };
      },
    );
    const retrySchedule = Schedule.exponential("250 millis").pipe(
      Schedule.jittered,
      Schedule.upTo({ times: 2 }),
      Schedule.addDelay(({ input }) =>
        Effect.succeed(
          Duration.millis(
            input instanceof ClassifierOverloaded ? input.retryAfterMs : 0,
          ),
        )
      ),
    );
    const classify = (
      state: string,
      questions: Readonly<Record<string, Classifier.Question>>,
    ) =>
      classifyAttempt(state, questions).pipe(
        Effect.retry({
          schedule: retrySchedule,
          while: (error) => error instanceof ClassifierOverloaded,
        }),
        Effect.catch((error) =>
          Effect.fail(
            error instanceof ClassifierOverloaded ||
              error instanceof ClassifierFailure
              ? error
              : classifierFailure(502, "unexpected_classifier_error", error),
          )
        ),
      );
    return Classifier.Service.of({ classify, model: config.model });
  }),
).pipe(Layer.provide(FetchHttpClient.layer));
