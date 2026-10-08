import { Effect } from "effect";
import { AccountExample } from "./account";
import { AccessExample } from "./access";
import { Counter } from "./counter";
import { component } from "./framework";
import { LoadingExample } from "./loading";
import { Tabs } from "./tabs";
import { TextInput } from "./text-input";
import { Todos } from "./todos";
import * as Sync from "./sync-public";

export const Examples = component(() =>
  Sync.succeed({
    setup: ({ he }) =>
      Effect.gen(function* () {
        return yield* he("main", {
          children: [
            yield* he("h1", { children: ["Examples"] }),
            yield* he("p", {
              children: ["Small, interactive examples of reactive state and scoped components."],
            }),
            Counter,
            TextInput,
            AccountExample,
            Tabs,
            AccessExample,
            LoadingExample,
            Todos,
          ],
        });
      }),
  }),
);
