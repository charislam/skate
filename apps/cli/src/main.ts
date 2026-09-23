import { Command } from "effect/unstable/cli";

const command = Command.make("skate");

export const cli = Command.run(command, {
  version: "0.0.1",
});
