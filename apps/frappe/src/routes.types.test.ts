import { Context as EffectContext, Effect, Option, Schema, SchemaTransformation } from "effect";
import { it, expectTypeOf } from "vitest";
import type { Route, UntypedDestination } from "./route-definition";
import { optionalQuery, parameter, route, router, type Destination } from "./routes";

it("infers destination and prefix alternatives from nested definitions", () => {
  const Id = Schema.String.pipe(Schema.brand("Id"));
  const urls = router([
    route({
      tag: "Projects",
      path: ["projects"],
      children: [
        route({
          tag: "Project",
          path: [parameter("id", Id)],
          children: [
            route({
              tag: "Settings",
              path: ["settings"],
              query: { q: optionalQuery(Schema.String) },
            }),
          ],
        }),
      ],
    }),
  ]);
  expectTypeOf(urls.definitions[0].tag).toEqualTypeOf<"Projects">();
  expectTypeOf(urls.definitions[0].children[0].children[0].children).toEqualTypeOf<readonly []>();

  type Inferred = Destination<typeof urls.definitions>;
  type Settings = Extract<Inferred, { _tag: "Settings" }>;
  type Project = Extract<Inferred, { _tag: "Project" }>;
  expectTypeOf<Inferred["_tag"]>().toEqualTypeOf<"Projects" | "Project" | "Settings">();
  expectTypeOf<Settings["params"]["id"]>().toEqualTypeOf<typeof Id.Type>();
  expectTypeOf<keyof Settings["params"]>().toEqualTypeOf<"id">();
  expectTypeOf<Settings["query"]["q"]>().toEqualTypeOf<Option.Option<string>>();
  expectTypeOf<keyof Settings["query"]>().toEqualTypeOf<"q">();
  expectTypeOf<keyof Project["query"]>().toEqualTypeOf<never>();

  const id = Schema.decodeUnknownSync(Id)("123");
  urls.build({
    _tag: "Settings",
    params: { id },
    query: { q: Option.none() },
    fragment: Option.none(),
  });
  // @ts-expect-error Unknown tag.
  urls.build({ _tag: "Unknown", params: {}, query: {}, fragment: Option.none() });
  // @ts-expect-error Missing inherited parameter.
  urls.build({
    _tag: "Settings",
    params: {},
    query: { q: Option.none() },
    fragment: Option.none(),
  });
  // @ts-expect-error Unbranded parameter.
  urls.build({ _tag: "Project", params: { id: "123" }, query: {}, fragment: Option.none() });
  // @ts-expect-error Optional query uses Option.
  urls.build({ _tag: "Settings", params: { id }, query: { q: "text" }, fragment: Option.none() });

  const result = urls.parse("/projects/123/missing");
  for (const prefix of result.ancestry) {
    // @ts-expect-error A root projects prefix cannot claim a project ID.
    void prefix.params.id;
    void prefix;
  }
});

class CodecService extends EffectContext.Service<CodecService, string>()("RouteTypes/Codec") {}
it("rejects codecs requiring runtime services", () => {
  const codec = Schema.String.pipe(
    Schema.decodeTo(
      Schema.String,
      SchemaTransformation.transformEffect({
        decode: (value: string) =>
          Effect.gen(function* () {
            yield* CodecService;
            return value;
          }),
        encode: (value: string) => Effect.succeed(value),
      }),
    ),
  );
  // @ts-expect-error URL parsing cannot acquire runtime services.
  parameter("value", codec);
});

// The builder's shared shape is guaranteed even with unresolved route generics.
const builderInput = <T extends ReadonlyArray<Route>>(
  destination: Destination<T>,
): UntypedDestination => destination;

it("assigns generic destinations to the builder shape without widening concrete fields", () => {
  const urls = router([route({ tag: "Home", path: [] })]);
  const destination: Destination<typeof urls.definitions> = {
    _tag: "Home",
    params: {},
    query: {},
    fragment: Option.none(),
  };
  expectTypeOf(
    builderInput<typeof urls.definitions>(destination),
  ).toEqualTypeOf<UntypedDestination>();
});
