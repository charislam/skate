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

const maxQuestionsPerRequest = 30;
const maxRequestBytes = 48 * 1024;

const toJevQuestions = (
  questions: Readonly<Record<string, Classifier.Question>>,
) =>
  Object.fromEntries(
    Object.entries(questions).map(([id, question]) => [
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

const requestBody = (
  state: Classifier.ClassifierState,
  model: string,
  questions: Readonly<Record<string, Classifier.Question>>,
) => ({ state, model, questions: toJevQuestions(questions) });

const partitionQuestions = (
  state: Classifier.ClassifierState,
  model: string,
  questions: Readonly<Record<string, Classifier.Question>>,
) => {
  const batches: Array<Record<string, Classifier.Question>> = [];
  let current: Record<string, Classifier.Question> = {};
  for (const [id, question] of Object.entries(questions)) {
    const candidate = { ...current, [id]: question };
    const candidateBytes = new TextEncoder().encode(
      JSON.stringify(requestBody(state, model, candidate)),
    ).byteLength;
    if (
      Object.keys(candidate).length <= maxQuestionsPerRequest &&
      candidateBytes <= maxRequestBytes
    ) {
      current = candidate;
      continue;
    }
    if (Object.keys(current).length > 0) {
      batches.push(current);
      current = {};
    }
    const singleton = { [id]: question };
    const singletonBytes = new TextEncoder().encode(
      JSON.stringify(requestBody(state, model, singleton)),
    ).byteLength;
    if (singletonBytes > maxRequestBytes) {
      return { batches, oversized: { questionId: id, bytes: singletonBytes } };
    }
    current = singleton;
  }
  if (Object.keys(current).length > 0) batches.push(current);
  return { batches, oversized: undefined };
};

export const jevLayer = Layer.effect(
  Classifier.Service,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const client = yield* HttpClient.HttpClient;
    const classifyAttempt = Effect.fn("ClassifierService.classify")(
      function* (
        state: Classifier.ClassifierState,
        questions: Readonly<Record<string, Classifier.Question>>,
      ) {
        const body = requestBody(state, config.model, questions);
        const requestBytes =
          new TextEncoder().encode(JSON.stringify(body)).byteLength;
        if (
          requestBytes > maxRequestBytes ||
          Object.keys(questions).length > maxQuestionsPerRequest
        ) {
          return yield* Effect.fail(
            classifierFailure(
              422,
              "classifier_budget",
              `Translated Jev request exceeds limits (questions=${
                Object.keys(questions).length
              }, bytes=${requestBytes})`,
            ),
          );
        }
        const request = yield* HttpClientRequest.post(
          "https://api.typesafe.ai/v1/systemone",
        ).pipe(
          HttpClientRequest.bearerToken(Redacted.value(config.typesafeApiKey)),
          HttpClientRequest.bodyJson(body),
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
            if (
              !(answer.choice in question.options)
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
    const classifyBatch = (
      state: Classifier.ClassifierState,
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
    const classify = (
      state: Classifier.ClassifierState,
      questions: Readonly<Record<string, Classifier.Question>>,
    ) =>
      Effect.gen(function* () {
        const partition = partitionQuestions(state, config.model, questions);
        if (partition.oversized !== undefined) {
          return yield* Effect.fail(
            classifierFailure(
              422,
              "classifier_budget",
              `Translated Jev request for question '${partition.oversized.questionId}' exceeds the 48-KiB limit (${partition.oversized.bytes} bytes)`,
            ),
          );
        }
        const classifications = yield* Effect.all(
          partition.batches.map((batch) => classifyBatch(state, batch)),
          { concurrency: 8 },
        );
        const usage = classifications.reduce(
          (total, result) => ({
            inputTokens: total.inputTokens + result.usage.inputTokens,
            outputTokens: total.outputTokens + result.usage.outputTokens,
          }),
          { inputTokens: 0, outputTokens: 0 },
        );
        return {
          answers: Object.fromEntries(
            classifications.flatMap((result) => Object.entries(result.answers)),
          ),
          providerModel: classifications[0]?.providerModel ?? config.model,
          usage,
        };
      });
    return Classifier.Service.of({ classify, model: config.model });
  }),
).pipe(Layer.provide(FetchHttpClient.layer));
