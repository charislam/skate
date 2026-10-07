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

export const Home = component(() =>
  Sync.succeed({
    setup: ({ he }) =>
      Effect.gen(function* () {
        return yield* he("main", {
          children: [
            yield* he("h1", { children: ["Budgerigar"] }),
            yield* he("p", { children: ["Effect-based FRP for the frontend"] }),
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
