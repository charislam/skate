import { Runtime } from "foldkit";
import { Flags, Model, flags, init, subscriptions, update, view } from "./main";

const application = Runtime.makeApplication({
  Model,
  Flags,
  init,
  update,
  subscriptions,
  view,
  container: document.getElementById("root"),
});

Runtime.run(application, { flags });
