import { Result, Effect } from "effect";
import { AccessExample } from "./access";
import { Counter } from "./counter";
import { component } from "./framework";
import { LoadingExample } from "./loading";
import { Tabs } from "./tabs";
import { TextInput } from "./text-input";
import { Todos } from "./todos";

export const Home = component(() =>
  Result.succeed({
    setup: ({ he }) =>
      Effect.gen(function* () {
        return yield* he("main", {
          children: [
            yield* he("h1", { children: ["Budgerigar"] }),
            yield* he("p", { children: ["Welcome home."] }),
            Counter,
            Counter,
            TextInput,
            Tabs,
            AccessExample,
            LoadingExample,
            Todos,
          ],
        });
      }),
  }),
);
