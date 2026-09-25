import { cn } from "cn";
import type { Html, HtmlBuilder } from "foldkit/html";

export type PageSlots = {
  readonly content: Html;
  readonly headerEnd?: Html;
  readonly footerStart?: Html;
  readonly width: "compact" | "wide";
};

export type Slots = PageSlots & { readonly menu: Html };

const brandView = <Message>(h: HtmlBuilder<Message>): Html =>
  h.hgroup(
    [h.Class("flex items-baseline")],
    [
      h.h1([h.Class("text-4xl")], ["skate"]),
      h.p([h.Class("text-sm text-slate-800 dark:text-slate-300 translate-y-1/4")], ["TO"]),
    ],
  );

export const view = <Message>(slots: Slots, h: HtmlBuilder<Message>): Html =>
  h.div(
    [
      h.Class(
        cn(
          "h-screen mx-auto px-4 xl:px-12 py-6 flex flex-col gap-8 lg:gap-12 bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100",
          slots.width === "compact" && "max-w-xl",
        ),
      ),
    ],
    [
      h.header(
        [h.Class("flex gap-2 justify-between items-baseline")],
        [brandView(h), slots.headerEnd ?? h.empty],
      ),
      h.main([h.Class("flex-1")], [slots.content]),
      h.footer(
        [h.Class("flex gap-2 justify-between items-baseline")],
        [h.div([], [slots.footerStart ?? h.empty]), slots.menu],
      ),
    ],
  );
