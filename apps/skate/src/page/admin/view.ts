import { Disclosure } from "@foldkit/ui";
import { AsyncData, Submodel } from "foldkit";
import { Match, Option } from "effect";
import { AdminAccess, canAccessAdmin } from "../../domain/admin-access";
import { Message } from "./message";
import type { Model } from "./model";
import type { Html, HtmlBuilder } from "foldkit/html";
import { Heading } from "~/view/heading";
import { type AdminSection, adminRouter, adminSourcesRouter } from "~/route";
import { view as sourcesTableView } from "./sources/view";
import * as SourcesTableMessage from "./sources/message";

const navigationLinks = [
  { section: "Overview", href: adminRouter({ section: "Overview" }) },
  { section: "Sources", href: adminSourcesRouter({ section: "Sources" }) },
] as const satisfies ReadonlyArray<{ readonly section: AdminSection; readonly href: string }>;

const navigation = (section: AdminSection, h: HtmlBuilder<Message>): Html =>
  h.nav(
    [h.AriaLabel("Admin navigation")],
    [
      h.ul(
        [h.Class("flex flex-col gap-2")],
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
                    "block px-3 py-2 text-sm tracking-wide border-slate-100 dark:border-slate-800 hover:border-l-8 aria-[current=page]:hover:border-l-0 aria-[current=page]:bg-slate-100 dark:aria-[current=page]:bg-slate-800",
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

const statsCard = (
  data: { title: string; href: string; asyncData: AsyncData.AsyncData<string, Error> },
  h: HtmlBuilder<Message>,
): Html =>
  h.section(
    [
      h.Class(
        "relative w-fit min-w-56 rounded border-b border-r border-slate-200 p-5 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-900",
      ),
    ],
    [
      h.h3(
        [h.Class("text-sm text-slate-600 tracking-wide dark:text-slate-300")],
        [
          h.a(
            [
              h.Href(data.href),
              h.Class(
                "before:absolute before:inset-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600",
              ),
            ],
            [data.title],
          ),
        ],
      ),
      h.p(
        [h.Class("mt-2 text-3xl font-semibold tabular-nums"), h.Role("status")],
        [
          AsyncData.match(data.asyncData, {
            onIdle: () => "—",
            onLoading: () => "Loading…",
            onRefreshing: (data) => data,
            onFailure: (error) => error.message,
            onStale: ({ data }) => data,
            onSuccess: (data) => data,
          }),
        ],
      ),
    ],
  );

const overviewSectionContent = (model: Model, h: HtmlBuilder<Message>): Array<Html> => [
  statsCard(
    {
      title: "Active sources",
      href: adminSourcesRouter({ section: "Sources" }),
      asyncData: AsyncData.map(model.activeSourceCount, (count) => count.toString()),
    },
    h,
  ),
];

const sourcesSectionContent = (model: Model, h: HtmlBuilder<Message>): Array<Html> => [
  h.submodel({
    slotId: "admin-sources-table",
    model: model.sourcesTable,
    view: sourcesTableView,
    toParentMessage: (message: SourcesTableMessage.Message) =>
      Message.GotSourcesTableMessage({ message }),
  }),
];

const sectionContent = (model: Model, section: AdminSection, h: HtmlBuilder<Message>): Html =>
  h.section(
    [h.AriaLabel(`${section} content`)],
    Match.value(section).pipe(
      Match.when("Overview", () => overviewSectionContent(model, h)),
      Match.when("Sources", () => sourcesSectionContent(model, h)),
      Match.exhaustive,
    ),
  );

export const headerEnd = <ParentMessage>(h: HtmlBuilder<ParentMessage>): Html =>
  h.h1([h.Class(Heading.capsHeadingStyle)], ["Admin"]);

const gatedAdmonition = (data: { adminAccess: AdminAccess }, h: HtmlBuilder<Message>): Html => {
  const maybeError = AsyncData.getError(data.adminAccess);
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
};

export const view = Submodel.defineView<
  Model,
  Message,
  { readonly section: AdminSection; readonly tabletOrAbove: boolean }
>((model, { section, tabletOrAbove }, h) => {
  if (!canAccessAdmin(model.adminAccess)) {
    return gatedAdmonition({ adminAccess: model.adminAccess }, h);
  }
  return h.div(
    [h.Class("flex flex-col gap-6 lg:flex-row lg:gap-10")],
    [
      tabletOrAbove
        ? h.aside([h.Class("w-48 shrink-0")], [navigation(section, h)])
        : compactNavigation(model, section, h),
      h.div([h.Class("min-w-0 flex-1")], [sectionContent(model, section, h)]),
    ],
  );
});
