import { Runtime } from "foldkit";
import { Flags, flags, init, subscriptions, update, view } from "./main";
import { Message } from "./message";
import { Model } from "./model";

const application = Runtime.makeApplication({
  Model,
  Flags,
  init,
  update,
  subscriptions,
  view,
  container: document.getElementById("root"),
  routing: {
    onUrlRequest: (request) => Message.ClickedLink({ request }),
    onUrlChange: (url) => Message.ChangedUrl({ url }),
  },
  devTools: {
    Message,
  },
});

Runtime.run(application, { flags });
