import { AsyncData, Submodel } from "foldkit";
import { Option } from "effect";
import { canAccessAdmin } from "../../domain/admin-access";
import { Message } from "./message";
import type { Model } from "./model";
import type { Session } from "../../domain/session";

export const view = Submodel.defineView<Model, Message, { readonly session: Session }>(
  (model, { session }, h) => {
    if (!canAccessAdmin(model.adminAccess)) {
      const maybeError = AsyncData.getError(model.adminAccess);
      return Option.match(maybeError, {
        onNone: () => h.p([h.Role("status")], ["Checking admin access…"]),
        onSome: (error) =>
          h.section(
            [],
            [
              h.p([h.Role("alert")], [error.message]),
              h.button([h.OnClick(Message.ClickedRetryAccess())], ["Try again"]),
            ],
          ),
      });
    }
    return h.section(
      [],
      [
        h.h1([h.Class("text-3xl")], ["Admin"]),
        h.p(
          [],
          [
            Option.match(session.email, {
              onNone: () => "Signed in",
              onSome: (email) => `Signed in as ${email}`,
            }),
          ],
        ),
        h.button([h.OnClick(Message.ClickedLogout())], ["Sign out"]),
      ],
    );
  },
);
