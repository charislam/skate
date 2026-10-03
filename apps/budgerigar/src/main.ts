import { Effect } from "effect";

import "./style.css";

const main = Effect.sync(() => {
  const home = document.createElement("main");
  home.innerHTML = `
    <h1>Budgerigar</h1>
    <p>Welcome home.</p>
  `;
  document.body.append(home);
});

Effect.runSync(main);
