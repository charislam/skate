import type { HtmlBuilder } from "foldkit/html";
import { MainMenu } from "~/domain";
import { Message } from "~/message";
import type { Model } from "~/model";

export const view = (model: Model, h: HtmlBuilder<Message>) =>
  h.submodel({
    slotId: "main-menu",
    model: model.menu,
    view: MainMenu.Popover.view,
    toParentMessage: (message) => Message.GotPopoverMessage({ message }),
    viewInputs: {
      ariaLabel: "Main menu",
      anchor: { placement: "top-end" },
      toView: (childAttributes) =>
        h.div(
          [h.Class("relative")],
          [
            h.button(
              [
                ...childAttributes.button,
                h.Class("text-3xl text-slate-600 hover:bg-slate-100 cursor-pointer"),
              ],
              [h.span([h.AriaHidden(true), h.InnerHTML("&#x2630;")])],
            ),
            ...(childAttributes.isVisible
              ? [
                  h.div([...childAttributes.backdrop, h.Class("fixed inset-0")]),
                  h.div(
                    [
                      ...childAttributes.panel,
                      h.Class(
                        "z-10 rounded border border-slate-200 bg-white shadow-lg outline-none",
                      ),
                    ],
                    [
                      h.div(
                        [],
                        [
                          h.span([], ["Menu"]),
                          ...(model.tabletOrAbove
                            ? MainMenu.actions.map((action) =>
                                h.keyed("button")(
                                  action,
                                  [
                                    h.Class(
                                      "block w-full px-3 py-2 text-left hover:bg-slate-100 cursor-pointer",
                                    ),
                                    h.OnClick(Message.SelectedMainMenuAction({ action })),
                                  ],
                                  [action],
                                ),
                              )
                            : []),
                        ],
                      ),
                    ],
                  ),
                ]
              : []),
          ],
        ),
    },
  });

export * as MainMenuView from "./main-menu";
