import { cn } from "cn";
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
      anchor: { placement: "top-end", gap: 8 },
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
                        "z-10 rounded-lg border border-slate-200 bg-white p-3 shadow-lg outline-none",
                      ),
                    ],
                    model.tabletOrAbove
                      ? [
                          h.div(
                            [],
                            [
                              h.h3(
                                [
                                  h.Id("main-menu-view-label"),
                                  h.Class("mb-2 text-xs font-medium text-slate-600"),
                                ],
                                ["View"],
                              ),
                              h.div(
                                [
                                  h.Role("group"),
                                  h.AriaLabelledBy("main-menu-view-label"),
                                  h.Class("inline-flex"),
                                ],
                                MainMenu.actions.map((action, index, arr) => {
                                  const isActive = model.activeDateRange._tag === action;
                                  return h.keyed("button")(
                                    action,
                                    [
                                      h.Type("button"),
                                      h.AriaPressed(isActive ? "true" : "false"),
                                      ...(isActive ? [h.Disabled(true)] : []),
                                      h.Class(
                                        cn(
                                          "px-3 py-1.5 text-xs font-medium border-t border-b border-r border-slate-200",
                                          index === 0 && "rounded-l-lg border-l",
                                          index === arr.length - 1 && "rounded-r-lg border-r",
                                          isActive
                                            ? "bg-slate-100 text-slate-900"
                                            : "text-slate-600 hover:bg-slate-100 cursor-pointer",
                                        ),
                                      ),
                                      ...(!isActive
                                        ? [h.OnClick(Message.SelectedMainMenuAction({ action }))]
                                        : []),
                                    ],
                                    [action],
                                  );
                                }),
                              ),
                            ],
                          ),
                        ]
                      : [],
                  ),
                ]
              : []),
          ],
        ),
    },
  });

export * as MainMenuView from "./main-menu";
