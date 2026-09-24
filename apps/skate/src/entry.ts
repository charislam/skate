import { Runtime } from "foldkit";
import { Flags, Model, flags, init, subscriptions, update, view } from "./main";
import { Message } from "./message";

const application = Runtime.makeApplication({
  Model,
  Flags,
  init,
  update,
  subscriptions,
  view,
  container: document.getElementById("root"),
  devTools: {
    Message,
  },
});

Runtime.run(application, { flags });
