import { cn } from "cn";
import { Option } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";
import { MainMenu } from "~/domain";
import { Message } from "~/message";
import type { Model } from "~/model";

export const view = (
  model: Pick<Model, "menu" | "theme">,
  inputs: { readonly sections: ReadonlyArray<Html> },
  h: HtmlBuilder<Message>,
) =>
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
                h.Class(
                  "text-3xl text-slate-600 hover:bg-slate-100 cursor-pointer dark:text-slate-300 dark:hover:bg-slate-800",
                ),
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
                        "z-10 rounded-lg border border-slate-200 bg-white p-3 shadow-lg outline-none dark:border-slate-700 dark:bg-slate-900",
                      ),
                    ],
                    [
                      h.div(
                        [
                          h.Class(
                            "flex flex-col divide-y divide-slate-200 dark:divide-slate-700 [&>*]:py-3 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0",
                          ),
                        ],
                        [
                          ...inputs.sections,
                          h.div(
                            [],
                            [
                              h.h3(
                                [
                                  h.Id("main-menu-theme-label"),
                                  h.Class(
                                    "mb-2 text-xs font-medium text-slate-600 dark:text-slate-300",
                                  ),
                                ],
                                ["Theme"],
                              ),
                              h.div(
                                [
                                  h.Role("group"),
                                  h.AriaLabelledBy("main-menu-theme-label"),
                                  h.Class("inline-flex"),
                                ],
                                (["system", "light", "dark"] as const).map((choice, index, arr) => {
                                  const isActive = Option.match(model.theme.userTheme, {
                                    onNone: () => choice === "system",
                                    onSome: (theme) => choice === theme,
                                  });
                                  const label =
                                    choice === "system"
                                      ? "System"
                                      : choice === "light"
                                        ? "Light"
                                        : "Dark";
                                  return h.keyed("button")(
                                    choice,
                                    [
                                      h.Type("button"),
                                      h.AriaPressed(isActive ? "true" : "false"),
                                      ...(isActive ? [h.Disabled(true)] : []),
                                      h.Class(
                                        cn(
                                          "px-3 py-1.5 text-xs font-medium border-t border-b border-r border-slate-200 dark:border-slate-700",
                                          index === 0 && "rounded-l-lg border-l",
                                          index === arr.length - 1 && "rounded-r-lg border-r",
                                          isActive
                                            ? "bg-slate-100 text-slate-900 dark:bg-slate-700 dark:text-white"
                                            : "text-slate-600 hover:bg-slate-100 cursor-pointer dark:text-slate-300 dark:hover:bg-slate-800",
                                        ),
                                      ),
                                      ...(!isActive
                                        ? [
                                            h.OnClick(
                                              Message.SelectedTheme({
                                                theme:
                                                  choice === "system"
                                                    ? Option.none()
                                                    : Option.some(choice),
                                              }),
                                            ),
                                          ]
                                        : []),
                                    ],
                                    [label],
                                  );
                                }),
                              ),
                            ],
                          ),
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
