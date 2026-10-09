import { Effect, Match, Option, Result, Schema, SchemaTransformation } from "effect";
import { describe, expect, it } from "vitest";
import {
  arrayQuery,
  defaultQuery,
  optionalQuery,
  parameter,
  remaining,
  requiredQuery,
  route,
  router,
  type Destination,
} from "./routes";

const ProjectId = Schema.NumberFromString.pipe(
  Schema.check(Schema.isInt(), Schema.isGreaterThan(0)),
  Schema.brand("ProjectId"),
);

const definitions = [
  route({
    tag: "Root",
    path: [],
    children: [
      route({
        tag: "Projects",
        path: ["projects"],
        children: [
          route({ tag: "New", path: ["new"] }),
          route({
            tag: "Project",
            path: [parameter("id", ProjectId)],
            children: [
              route({
                tag: "Settings",
                path: ["settings"],
                query: {
                  page: defaultQuery(Schema.NumberFromString.pipe(Schema.check(Schema.isInt())), 1),
                  q: optionalQuery(Schema.String),
                  filter: arrayQuery(Schema.String),
                },
              }),
            ],
          }),
        ],
      }),
      route({ tag: "Search", path: ["search"], query: { q: requiredQuery(Schema.String) } }),
      route({ tag: "Files", path: ["files", remaining("parts")] }),
    ],
  }),
] as const;

const urls = router(definitions);

type Target = Destination<typeof definitions>;

const matched = (url: string) =>
  Match.value(urls.parse(url)).pipe(
    Match.tag("Matched", ({ destination }) => destination),
    Match.orElse((failure) => {
      throw new Error(JSON.stringify(failure));
    }),
  );

describe("typed route codecs", () => {
  it("round trips inherited brands, defaults, options, arrays, fragments, and escaping", () => {
    const destination: Target = {
      _tag: "Settings",
      params: { id: Schema.decodeUnknownSync(ProjectId)("123") },
      query: { page: 1, q: Option.some("a/b & c"), filter: ["b", "a"] },
      fragment: Option.some("section/2"),
    };
    const href = Result.getOrThrow(urls.build(destination));
    expect(href).toBe("/projects/123/settings?q=a%2Fb+%26+c&filter=b&filter=a#section%2F2");
    expect(matched(href)).toEqual(destination);
    expect(matched("/projects/00123/settings/?unknown=ignored")).toEqual({
      ...destination,
      query: { page: 1, q: Option.none(), filter: [] },
      fragment: Option.none(),
    });
    expect(Result.getOrThrow(urls.build(matched("/files/a%2Fb//c")))).toBe("/files/a%2Fb//c");
    expect(matched("/%70rojects/new")._tag).toBe("New");
  });

  it("retains only validated ancestors for nested invalid and unknown URLs", () => {
    const invalid = urls.parse("/projects/wrong-id");
    expect(invalid._tag).toBe("InvalidUrl");
    expect(invalid.ancestry.map((prefix) => prefix._tag)).toEqual(["Root", "Projects"]);
    const nested = urls.parse("/projects/123/doesnt-exist");
    expect(nested._tag).toBe("NotFound");
    expect(nested.ancestry.map((prefix) => prefix._tag)).toEqual(["Root", "Projects", "Project"]);
    expect(nested.ancestry.at(-1)?.params).toEqual({ id: 123 });

    const unknown = urls.parse("/doesnt-exist");
    expect(unknown.ancestry.map((prefix) => prefix._tag)).toEqual(["Root"]);

    expect(urls.parse("/Projects")._tag).toBe("NotFound");

    const query = urls.parse("/projects/123/settings?page=no");
    expect(query.ancestry.map((prefix) => prefix._tag)).toEqual(["Root", "Projects", "Project"]);
    expect(
      Match.value(query).pipe(
        Match.tag("InvalidUrl", ({ issue }) => issue.route),
        Match.orElse(() => Option.none()),
      ),
    ).toEqual(Option.some("Settings"));
  });

  it("reports malformed encodings, repeated scalars and missing required values", () => {
    for (const url of [
      "/projects/%ZZ",
      "/search?q=%C0%AF",
      "/search?q=a&q=b",
      "/search",
      "/projects/1#%ZZ",
    ])
      expect(urls.parse(url)._tag).toBe("InvalidUrl");

    expect(urls.parse("/projects/1//settings")._tag).toBe("NotFound");
    expect(urls.parse("/files/a%2Fb")).toMatchObject({
      _tag: "Matched",
      destination: { params: { parts: ["a/b"] } },
    });
  });

  it("uses declaration order without schema failure fallthrough", () => {
    const ordered = router([
      route({ tag: "Number", path: [parameter("id", ProjectId)] }),
      route({ tag: "String", path: [parameter("name", Schema.String)] }),
      route({ tag: "Catch", path: [remaining("parts")] }),
    ]);
    expect(ordered.parse("/wrong")._tag).toBe("InvalidUrl");
    expect(ordered.parse("/123/child")).toMatchObject({
      _tag: "NotFound",
      ancestry: [{ _tag: "Number", params: { id: 123 } }],
    });
  });

  it("rejects conflicting inherited names and reports encoding errors", () => {
    expect(() =>
      router([
        route({
          tag: "A",
          path: [parameter("id", Schema.String)],
          children: [route({ tag: "B", path: [parameter("id", Schema.String)] })],
        }),
      ]),
    ).toThrow("Conflicting inherited parameter");

    const invalid: unknown = {
      _tag: "Project",
      params: { id: -1 },
      query: {},
      fragment: Option.none(),
    };
    // @ts-expect-error Untyped malformed destination exercises the encoder boundary.
    expect(Result.isFailure(urls.build(invalid))).toBe(true);
  });
});

it("keeps empty fragments and rejects async/defective schema work through typed outcomes", () => {
  expect(matched("/projects/new#").fragment).toEqual(Option.some(""));
  expect(Result.getOrThrow(urls.build(matched("/projects/new#")))).toBe("/projects/new#");

  const asynchronous = Schema.String.pipe(
    Schema.decodeTo(
      Schema.String,
      SchemaTransformation.transformEffect({
        decode: (value: string) => Effect.promise(() => Promise.resolve(value)),
        encode: (value: string) => Effect.promise(() => Promise.resolve(value)),
      }),
    ),
  );
  const asyncRouter = router([route({ tag: "Async", path: [parameter("value", asynchronous)] })]);
  expect(asyncRouter.parse("/value")._tag).toBe("InvalidUrl");
  expect(
    Result.isFailure(
      asyncRouter.build({
        _tag: "Async",
        params: { value: "value" },
        query: {},
        fragment: Option.none(),
      }),
    ),
  ).toBe(true);

  const defective = Schema.String.pipe(
    Schema.decodeTo(
      Schema.String,
      SchemaTransformation.transform({
        decode: (_value: string): string => {
          throw new Error("decode defect");
        },
        encode: (_value: string): string => {
          throw new Error("encode defect");
        },
      }),
    ),
  );
  const defectiveRouter = router([route({ tag: "Defect", path: [parameter("value", defective)] })]);
  expect(defectiveRouter.parse("/value")._tag).toBe("InvalidUrl");
  expect(
    Result.isFailure(
      defectiveRouter.build({
        _tag: "Defect",
        params: { value: "value" },
        query: {},
        fragment: Option.none(),
      }),
    ),
  ).toBe(true);
});

it("omits encoded-equivalent object defaults and refuses terminal empty path values", () => {
  const Box = Schema.String.pipe(
    Schema.decodeTo(
      Schema.Struct({ value: Schema.String }),
      SchemaTransformation.transform({
        decode: (value: string) => ({ value }),
        encode: (box: { readonly value: string }) => box.value,
      }),
    ),
  );
  const boxed = router([
    route({ tag: "Box", path: ["box"], query: { value: defaultQuery(Box, { value: "default" }) } }),
  ]);
  const destination = {
    _tag: "Box",
    params: {},
    query: { value: { value: "default" } },
    fragment: Option.none(),
  } as const;
  expect(Result.getOrThrow(boxed.build(destination))).toBe("/box");
  expect(boxed.parse("/box")).toMatchObject({ _tag: "Matched", destination });
  expect(
    Result.isFailure(
      urls.build({
        _tag: "Files",
        params: { parts: ["a", ""] },
        query: {},
        fragment: Option.none(),
      }),
    ),
  ).toBe(true);
});

it("refuses successful builds for destinations shadowed by an earlier declaration", () => {
  const overlapping = router([
    route({ tag: "Literal", path: ["new"] }),
    route({ tag: "Dynamic", path: [parameter("id", Schema.String)] }),
  ]);
  expect(
    Result.isFailure(
      overlapping.build({
        _tag: "Dynamic",
        params: { id: "new" },
        query: {},
        fragment: Option.none(),
      }),
    ),
  ).toBe(true);
  expect(
    Result.getOrThrow(
      overlapping.build({
        _tag: "Dynamic",
        params: { id: "other" },
        query: {},
        fragment: Option.none(),
      }),
    ),
  ).toBe("/other");
  expect(() =>
    router([
      route({
        tag: "InvalidDefault",
        path: [],
        query: {
          page: defaultQuery(
            Schema.NumberFromString.pipe(Schema.check(Schema.isGreaterThan(0))),
            -1,
          ),
        },
      }),
    ]),
  ).toThrow("query default");
});
