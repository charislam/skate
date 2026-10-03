import { Effect } from "effect";
import { component } from "./framework";

export const Home = component({
  setup: () =>
    Effect.sync(() => {
      const main = document.createElement("main");
      const heading = document.createElement("h1");
      heading.append(document.createTextNode("Budgerigar"));
      const paragraph = document.createElement("p");
      paragraph.append(document.createTextNode("Welcome home."));
      main.append(heading, paragraph);
      return main;
    }),
});
