import { Disclosure } from "@foldkit/ui";
import { AsyncData, Submodel } from "foldkit";
import { Option } from "effect";
import { canAccessAdmin } from "../../domain/admin-access";
import { Message } from "./message";
import type { Model } from "./model";
import type { Html, HtmlBuilder } from "foldkit/html";
import { Heading } from "~/view/heading";
import { type AdminSection, adminRouter, adminSourcesRouter } from "~/route";

const navigationLinks = [
  { section: "Overview", href: adminRouter({ section: "Overview" }) },
  { section: "Sources", href: adminSourcesRouter({ section: "Sources" }) },
] as const satisfies ReadonlyArray<{ readonly section: AdminSection; readonly href: string }>;

const navigation = (section: AdminSection, h: HtmlBuilder<Message>): Html =>
  h.nav(
    [h.AriaLabel("Admin navigation")],
    [
      h.ul(
        [h.Class("flex flex-col gap-1")],
        navigationLinks.map((link) =>
          h.keyed("li")(
            link.section,
            [],
            [
              h.a(
                [
                  h.Href(link.href),
                  ...(section === link.section ? [h.AriaCurrent("page")] : []),
                  h.Class(
                    "block rounded px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-800 aria-[current=page]:bg-slate-100 aria-[current=page]:font-semibold dark:aria-[current=page]:bg-slate-800",
                  ),
                ],
                [link.section],
              ),
            ],
          ),
        ),
      ),
    ],
  );

const compactNavigation = (model: Model, section: AdminSection, h: HtmlBuilder<Message>): Html =>
  Disclosure.view(
    {
      id: "admin-navigation",
      isOpen: model.isNavigationOpen,
      onToggle: (isOpen) => Message.ToggledNavigation({ isOpen }),
      toView: ({ button, panel, animatePanel }) =>
        h.div(
          [h.Class("rounded border border-slate-200 dark:border-slate-700")],
          [
            h.button(
              [
                ...button,
                h.Class(
                  "flex w-full cursor-pointer items-center justify-between px-3 py-2 text-left text-sm font-medium",
                ),
              ],
              [
                h.span([], [section]),
                h.span([h.AriaHidden(true)], [model.isNavigationOpen ? "−" : "+"]),
              ],
            ),
            animatePanel(
              h.div(
                [...panel, h.Class("border-t border-slate-200 p-2 dark:border-slate-700")],
                [navigation(section, h)],
              ),
            ),
          ],
        ),
    },
    h,
  );

const sectionContent = (section: AdminSection, h: HtmlBuilder<Message>): Html =>
  h.section(
    [h.AriaLabel(`${section} content`)],
    [h.h2([h.Class("text-xl font-medium")], [section])],
  );

export const headerEnd = <ParentMessage>(h: HtmlBuilder<ParentMessage>): Html =>
  h.h1([h.Class(Heading.capsHeadingStyle)], ["Admin"]);

export const view = Submodel.defineView<
  Model,
  Message,
  { readonly section: AdminSection; readonly tabletOrAbove: boolean }
>((model, { section, tabletOrAbove }, h) => {
  if (!canAccessAdmin(model.adminAccess)) {
    const maybeError = AsyncData.getError(model.adminAccess);
    return Option.match(maybeError, {
      onNone: () => h.p([h.Role("status")], ["Checking admin access…"]),
      onSome: (error) =>
        h.section(
          [h.Class("flex flex-col gap-4")],
          [
            h.p([h.Role("alert")], [error.message]),
            h.button(
              [
                h.OnClick(Message.ClickedRetryAccess()),
                h.Class(
                  "cursor-pointer w-fit border rounded px-4 py-1 text-sm hover:bg-slate-100 dark:hover:bg-slate-800",
                ),
              ],
              ["Try again"],
            ),
          ],
        ),
    });
  }
  return h.div(
    [h.Class("flex flex-col gap-6 lg:flex-row lg:gap-10")],
    [
      tabletOrAbove
        ? h.aside(
            [h.Class("w-48 shrink-0")],
            [h.h2([h.Class("mb-3 text-sm font-semibold")], ["Admin"]), navigation(section, h)],
          )
        : compactNavigation(model, section, h),
      h.div([h.Class("min-w-0 flex-1")], [sectionContent(section, h)]),
    ],
  );
});
