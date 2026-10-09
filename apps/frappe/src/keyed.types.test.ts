import { Effect } from "effect";
import { expectTypeOf, it } from "vitest";
import {
  component,
  keyed,
  row,
  type ComponentContext,
  type KeyedList,
  type Lifecycle,
  type ReactiveError,
  type Row,
  type RowInputs,
  type Signal,
} from "./framework";
import { testText } from "./output-test-helpers";
import * as Sync from "./sync-public";

it("infers item and lifecycle types and accepts lists at every construction boundary", () => {
  interface Item {
    readonly id: string;
    readonly text: string;
  }
  const author = (options: {
    items: Signal<ReadonlyArray<Item>>;
    context: ComponentContext;
    target: Element;
  }) => {
    const descriptor = row<Item>()(({ context, inputs }) => {
      expectTypeOf(inputs).toEqualTypeOf<RowInputs<Item>>();
      expectTypeOf(inputs.index).toEqualTypeOf<Signal<number>>();
      // @ts-expect-error Item inputs are read-only signals.
      inputs.item.set({ id: "a", text: "new" });
      // @ts-expect-error Index inputs cannot be written.
      inputs.index.set(1);
      return context.read(inputs.item).pipe(
        Sync.map((item) => ({
          fallback: () => Sync.fail("pending error" as const),
          setup: () => Effect.fail(item.text),
        })),
      );
    });
    expectTypeOf(descriptor.factory).returns.toExtend<
      Sync.Sync<Lifecycle<string, "pending error", unknown, unknown, unknown>, unknown, unknown>
    >();
    expectTypeOf(descriptor).toEqualTypeOf<
      Row<Item, never, ReactiveError, string, "pending error">
    >();
    const inferred = row<Item>()(() => Sync.succeed({ setup: () => Effect.succeed([]) }));
    expectTypeOf(inferred).toEqualTypeOf<Row<Item, never, never, never, never>>();
    // @ts-expect-error Factories belong in the second call, including with an explicit item type.
    row<Item>(() => Sync.succeed({ setup: () => Effect.succeed([]) }));
    // @ts-expect-error The uncurried signature is not supported.
    row(() => Sync.succeed({ setup: () => Effect.succeed([]) }));
    const list = keyed({ items: options.items, key: (item) => item.id, row: () => descriptor });
    expectTypeOf(list).toEqualTypeOf<KeyedList<Item>>();
    options.context.h(options.target, list);
    options.context.h(options.target, [list, testText("after")]);
    options.context.he("ol", { children: [list] });
    component(() =>
      Sync.succeed({ fallback: () => Sync.succeed(list), setup: () => Effect.succeed(list) }),
    );
    // @ts-expect-error Bare array signals are not declarative list descriptions.
    options.context.h(options.target, options.items);
    // @ts-expect-error Keys must be strings or numbers.
    keyed({ items: options.items, key: (item) => item, row: () => descriptor });
    keyed({
      items: options.items,
      key: (item) => item.id,
      // @ts-expect-error Row selectors return branded descriptors, not components.
      row: () => component(() => Sync.succeed({ setup: () => Effect.succeed([]) })),
    });
    const other = row<number>()(() => Sync.succeed({ setup: () => Effect.succeed([]) }));
    // @ts-expect-error A descriptor for a different item domain is incompatible.
    keyed({ items: options.items, key: (item) => item.id, row: () => other });
  };
  void author;
});
