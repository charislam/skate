import type { Option } from "effect";
import type { Component } from "./component";
import type { KeyedList } from "./keyed";
import type { ElementOutput } from "./output";
import type { Signal } from "./reactive/signal";

/** This marker is bookkeeping in a computation's R channel, never a service token. */
declare const StructuralTypeId: unique symbol;

interface StructuralMarker<out R> {
  readonly [StructuralTypeId]: R;
}
export type Structural<R> = [R] extends [never] ? never : StructuralMarker<R>;

/** Normalize after ordinary computation provision, at the component boundary. */
export type Normalize<R> = R extends StructuralMarker<infer Child> ? Normalize<Child> : R;

export type OutputRequirements<T> =
  T extends ElementOutput<Node, infer R>
    ? R
    : T extends Component<infer R>
      ? R
      : T extends Signal<Option.Option<Component<infer R>>>
        ? R
        : T extends KeyedList<unknown, infer R>
          ? R
          : T extends ReadonlyArray<infer Entry>
            ? OutputRequirements<Entry>
            : never;
