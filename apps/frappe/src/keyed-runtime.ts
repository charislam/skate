import { Effect, Match, Option, Result } from "effect";
import { component, type Component } from "./component";
import { makeRegion, type Region } from "./construction";
import {
  planKeyed,
  sameRow,
  unchangedPlan,
  type Key,
  type KeyedEntry,
  type KeyedList,
  type KeyedPlan,
  type Row,
} from "./keyed";
import type { ReactiveRuntime } from "./reactive/runtime";
import { deriveSync, makeCell, readonlySignal, signalData } from "./reactive/signal";
import { lazy } from "./synchronous";

export interface RowContext {
  readonly list: object;
  readonly key: Key;
  readonly descriptor: Row<unknown, unknown>;
}
interface ListOwner {
  readonly active: boolean;
  readonly dom: Set<Node>;
  readonly bindingCleanups: Set<() => void>;
  readonly ownsTarget: (node: Node) => boolean;
  readonly reactiveRuntime: Option.Option<ReactiveRuntime>;
}
interface Record<O> {
  entry: KeyedEntry;
  readonly region: Region;
  owner: Option.Option<O>;
}
interface Hooks<O> {
  readonly createOwner: (options: {
    lifetime: O;
    row: Option.Option<RowContext>;
  }) => Effect.Effect<{
    owner: O;
    runtime: ReactiveRuntime;
  }>;
  readonly retire: (owner: O) => void;
  readonly activate: (options: {
    lifetime: O;
    region: Region;
    definition: Component<unknown>;
    onOccurrenceFailure: () => void;
  }) => Effect.Effect<unknown>;
}

/** Move an anchored range, restoring editing focus lost by native insertBefore. */
const moveRange = (options: { region: Region; before: Node }): void => {
  const { region, before } = options;
  Match.value(region.end.nextSibling === before).pipe(
    Match.when(true, () => {}),
    Match.when(false, () => {
      const nodes: Node[] = [];
      let cursor: Node | null = region.start;
      while (cursor !== null) {
        nodes.push(cursor);
        const next: Node | null = cursor.nextSibling;
        const finished: boolean = cursor === region.end;
        cursor = Match.value(finished).pipe(
          Match.when(true, () => null),
          Match.orElse(() => next),
        );
      }
      const focused = Option.filter(
        Option.fromNullOr(region.start.ownerDocument.activeElement),
        (element): element is HTMLElement =>
          element instanceof HTMLElement &&
          nodes.some((node) => node === element || node.contains(element)),
      );
      const selection = Option.flatMap(focused, (element) =>
        Match.value(element).pipe(
          Match.when(
            (element): element is HTMLInputElement | HTMLTextAreaElement =>
              element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement,
            (element) =>
              Option.map(Option.fromNullOr(element.selectionStart), (start) => ({
                element,
                start,
                end: element.selectionEnd,
                direction: element.selectionDirection,
              })),
          ),
          Match.orElse(() => Option.none()),
        ),
      );
      for (const node of nodes) before.parentNode?.insertBefore(node, before);
      Option.match(focused, {
        onNone: () => {},
        onSome: (element) => {
          Match.value(element.isConnected && element.ownerDocument.activeElement !== element).pipe(
            Match.when(true, () => element.focus({ preventScroll: true })),
            Match.orElse(() => {}),
          );
        },
      });
      Option.match(selection, {
        onNone: () => {},
        onSome: ({ element, start, end, direction }) => {
          element.setSelectionRange(start, end, direction ?? undefined);
        },
      });
    }),
    Match.exhaustive,
  );
};

/** List plans and row inputs are graph dependencies, never a second reactive commit. */
export const activateKeyed = <O extends ListOwner>(options: {
  readonly region: Region;
  readonly description: KeyedList<unknown, unknown>;
  readonly lifetime: O;
  readonly hooks: Hooks<O>;
}): Effect.Effect<void> =>
  Effect.gen(function* () {
    const { region, description, hooks } = options;
    region.activated = true;
    const { owner: controller, runtime } = yield* hooks.createOwner({
      lifetime: options.lifetime,
      row: Option.none(),
    });
    const records = new Map<Key, Record<O>>();
    const source = signalData(description.items);
    const initial = yield* lazy(() => planKeyed({ description, value: source.committed() })).pipe(
      Effect.orDie,
    );
    const plan = readonlySignal(
      makeCell({
        runtime,
        initial,
        structural: true,
        dependencies: [source.participant],
        compute: Option.some((transaction) =>
          source
            .candidate(transaction)
            .pipe(Result.flatMap((value) => planKeyed({ description, value }))),
        ),
        equals: unchangedPlan,
        onPrepare: ({ transaction, proposed }) => {
          for (const record of records.values()) {
            const retained = Option.exists(
              Option.fromUndefinedOr(proposed.byKey.get(record.entry.key)),
              (entry) => sameRow({ previous: record.entry, proposed: entry }),
            );
            Match.value(retained).pipe(
              Match.when(false, () =>
                Option.match(record.owner, {
                  onNone: () => {},
                  onSome: (owner) =>
                    Option.match(owner.reactiveRuntime, {
                      onNone: () => {},
                      onSome: (runtime) => transaction.retired.add(runtime.lifetime),
                    }),
                }),
              ),
              Match.orElse(() => {}),
            );
          }
        },
      }),
    );
    const currentPlan = () => signalData(plan).committed();
    const remove = (record: Record<O>) => {
      Option.match(record.owner, { onNone: () => {}, onSome: hooks.retire });
      record.owner = Option.none();
      for (const node of [record.region.start, record.region.end]) {
        controller.dom.delete(node);
        node.parentNode?.removeChild(node);
      }
    };
    const start = (record: Record<O>): Effect.Effect<void> =>
      Effect.gen(function* () {
        const entry = record.entry;
        const { owner, runtime: inputsRuntime } = yield* hooks.createOwner({
          lifetime: controller,
          row: Option.some({ list: region, key: entry.key, descriptor: entry.descriptor }),
        });
        record.owner = Option.some(owner);
        const lookup = (value: KeyedPlan) => value.byKey.get(entry.key) ?? entry;
        const item = yield* lazy(() =>
          deriveSync({
            runtime: inputsRuntime,
            sources: { plan },
            compute: ({ plan }) => lookup(plan).item,
          }),
        ).pipe(Effect.orDie);
        const index = yield* lazy(() =>
          deriveSync({
            runtime: inputsRuntime,
            sources: { plan },
            compute: ({ plan }) => lookup(plan).index,
          }),
        ).pipe(Effect.orDie);
        const definition = component((context) =>
          entry.descriptor.factory({
            context,
            inputs: { key: entry.key, item, index },
          }),
        );
        yield* hooks.activate({
          lifetime: owner,
          region: record.region,
          definition,
          onOccurrenceFailure: () => {
            record.entry = currentPlan().byKey.get(entry.key) ?? record.entry;
            record.owner = Option.none();
            hooks.retire(owner);
          },
        });
      });
    const reconcile = (): Effect.Effect<void> =>
      Effect.gen(function* () {
        yield* Match.value(controller.active).pipe(
          Match.when(false, () => Effect.void),
          Match.when(true, () =>
            Effect.gen(function* () {
              const desired = currentPlan();
              for (const [key, record] of records) {
                const retained = Option.exists(
                  Option.fromUndefinedOr(desired.byKey.get(key)),
                  (entry) => sameRow({ previous: record.entry, proposed: entry }),
                );
                Match.value(retained).pipe(
                  Match.when(false, () => {
                    remove(record);
                    records.delete(key);
                  }),
                  Match.orElse(() => {}),
                );
              }
              const additions: Record<O>[] = [];
              for (const entry of desired.entries) {
                const record = Option.getOrElse(
                  Option.fromUndefinedOr(records.get(entry.key)),
                  () => {
                    const rowRegion = makeRegion({ definition: description, issuer: controller });
                    const created: Record<O> = { entry, region: rowRegion, owner: Option.none() };
                    records.set(entry.key, created);
                    for (const node of [rowRegion.start, rowRegion.end]) {
                      controller.dom.add(node);
                      region.end.parentNode?.insertBefore(node, region.end);
                    }
                    additions.push(created);
                    return created;
                  },
                );
                Match.value(
                  Option.isNone(record.owner) && !Object.is(record.entry.item, entry.item),
                ).pipe(
                  Match.when(true, () => additions.push(record)),
                  Match.orElse(() => {}),
                );
                record.entry = entry;
              }
              let before: Node = region.end;
              for (const entry of [...desired.entries].reverse()) {
                Option.match(Option.fromUndefinedOr(records.get(entry.key)), {
                  onNone: () => {},
                  onSome: (record) => {
                    moveRange({ region: record.region, before });
                    before = record.region.start;
                  },
                });
              }
              for (const record of additions) yield* start(record);
            }),
          ),
          Match.exhaustive,
        );
      });
    controller.bindingCleanups.add(
      signalData(plan).bind({
        validate: () => Result.succeed(undefined),
        flush: reconcile,
      }),
    );
    controller.bindingCleanups.add(() => records.clear());
    yield* reconcile();
  });
