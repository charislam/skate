import { Effect, FileSystem, Layer, Path, Stdio, Terminal } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import { cli } from "./main.js";

declare const process: { readonly argv: ReadonlyArray<string> };

const cliServices = Layer.mergeAll(
  FileSystem.layerNoop({}),
  Path.layer,
  Stdio.layerTest({ args: Effect.succeed(process.argv.slice(2)) }),
  Layer.succeed(
    Terminal.Terminal,
    Terminal.make({
      columns: Effect.succeed(80),
      rows: Effect.succeed(24),
      readInput: Effect.die("Interactive input is not configured"),
      readLine: Effect.die("Interactive input is not configured"),
      display: (text) => Effect.sync(() => console.log(text)),
    }),
  ),
  Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make(() => Effect.die("Child processes are not configured")),
  ),
);

Effect.runPromise(Effect.provide(cli, cliServices));
