import { Runtime } from "foldkit";
import { Layer } from "effect";
import { Auth } from "./domain/auth";
import * as AuthConfig from "./domain/auth-config";
import { Flags, flags, init, subscriptions, update, view } from "./main";
import { Message } from "./message";
import { Model } from "./model";

const application = Runtime.makeApplication({
  Model,
  Flags,
  init,
  update,
  subscriptions,
  resources: Auth.layerConfig.pipe(Layer.provide(AuthConfig.layer)),
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
