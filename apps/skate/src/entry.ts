import { Runtime } from "foldkit";
import { Flags, Model, flags, init, update, view } from "./main";

const application = Runtime.makeApplication({
  Model,
  Flags,
  init,
  update,
  view,
  container: document.getElementById("root"),
});

Runtime.run(application, { flags });
