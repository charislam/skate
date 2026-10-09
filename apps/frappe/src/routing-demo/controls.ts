import { Effect, Option } from "effect";
import { component } from "~/component";
import * as Popover from "~/popover";
import type { Signal } from "~/reactive";
import * as Sync from "~/sync";
import { MockAuth, MockProjects } from "./resources";
import { button } from "./ui";

export const routingControls = <E, R>(options: {
  readonly pendingLabel: Signal<string>;
  readonly rejectNext: Effect.Effect<unknown, E, R>;
  readonly reconcile: Effect.Effect<unknown, E, R>;
}) => {
  return component((context) =>
    Sync.gen(function* () {
      const auth = yield* Sync.service(MockAuth);
      const projects = yield* Sync.service(MockProjects);
      const popover = yield* Popover.make({
        context,
        initialOpen: false,
        positioning: { placement: "bottom-end", gap: 8, padding: 12 },
      });
      const trigger = yield* context.he("button", {
        props: { type: "button" },
        children: ["Controls"],
      });
      const panel = yield* context.he("section", {
        attrs: {
          class: Option.some("routing-controls"),
          "aria-label": Option.some("Routing controls"),
        },
        children: [
          yield* context.he("section", {
            children: [
              yield* context.he("h3", { children: ["Session"] }),
              yield* button(context, {
                label: "Discover anonymous",
                action: auth.resolve(Option.none()),
              }),
              yield* button(context, {
                label: "Discover Ada",
                action: auth.resolve(Option.some({ name: "Ada" })),
              }),
              yield* button(context, {
                label: "Switch to Grace",
                action: auth.signIn({ name: "Grace" }),
              }),
              yield* button(context, {
                label: "New Ada session",
                action: auth.signIn({ name: "Ada" }),
              }),
              yield* button(context, { label: "Refresh session", action: auth.refresh }),
              yield* button(context, { label: "Log out", action: auth.logout }),
              yield* button(context, { label: "Expire session", action: auth.expire }),
            ],
          }),
          yield* context.he("section", {
            children: [
              yield* context.he("h3", { children: ["Project loading"] }),
              yield* button(context, {
                label: "Immediate projects",
                action: projects.mode("Immediate"),
              }),
              yield* button(context, {
                label: "Delay projects",
                action: projects.mode("Delayed"),
              }),
              yield* button(context, {
                label: "Fail projects",
                action: projects.mode("Failed"),
              }),
              yield* button(context, {
                label: "Complete acquisitions",
                action: projects.complete(true),
              }),
              yield* button(context, {
                label: "Fail acquisitions",
                action: projects.complete(false),
              }),
              yield* context.he("output", { children: [options.pendingLabel] }),
            ],
          }),
          yield* context.he("section", {
            children: [
              yield* context.he("h3", { children: ["History"] }),
              yield* button(context, {
                label: "Reject next history write",
                action: options.rejectNext,
              }),
              yield* button(context, {
                label: "Reconcile URL",
                action: options.reconcile,
              }),
            ],
          }),
        ],
      });

      yield* popover.attach({ trigger, panel });
      return { setup: () => Effect.succeed([trigger, panel]) };
    }),
  );
};
