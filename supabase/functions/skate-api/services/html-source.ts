import { Context, Effect, Scope } from "effect";
import { DOMParser } from "linkedom";
import {
  SourceContentTooLarge,
  SourceFailure,
  UnsafeSourceUrl,
} from "../domain/source.ts";

export interface HtmlBlock {
  readonly id: string;
  readonly text: string;
}
export interface HtmlDocument {
  readonly fetchedAt: string;
  readonly blocks: ReadonlyArray<HtmlBlock>;
  readonly context: string;
}
export interface Interface {
  readonly fetch: (
    url: string,
  ) => Effect.Effect<
    HtmlDocument,
    SourceContentTooLarge | UnsafeSourceUrl | SourceFailure,
    Scope.Scope
  >;
}
export class Service
  extends Context.Service<Service, Interface>()("SkateApi/HtmlSource") {}
export * as HtmlSource from "./html-source.ts";

export const normalizeHtml = (html: string): ReadonlyArray<HtmlBlock> => {
  const document = new DOMParser().parseFromString(html, "text/html");
  document.querySelectorAll(
    "script,style,noscript,svg,nav,footer,header,form,iframe",
  ).forEach((node: unknown) => {
    if (
      typeof node === "object" && node !== null && "remove" in node &&
      typeof node.remove === "function"
    ) node.remove();
  });
  const blocks = Array.from(
    document.querySelectorAll("h1,h2,h3,h4,p,li,tr,caption,dt,dd"),
  )
    .map((node: unknown) => {
      if (typeof node !== "object" || node === null) return "";
      if (
        "querySelectorAll" in node &&
        typeof node.querySelectorAll === "function"
      ) {
        const cells = Array.from(node.querySelectorAll("th,td"))
          .map((cell: unknown) =>
            typeof cell === "object" && cell !== null &&
              "textContent" in cell && typeof cell.textContent === "string"
              ? cell.textContent.replace(/\s+/g, " ").trim()
              : ""
          )
          .filter(Boolean);
        if (cells.length > 0) return cells.join(" | ");
      }
      return "textContent" in node && typeof node.textContent === "string"
        ? node.textContent.replace(/\s+/g, " ").trim()
        : "";
    })
    .filter((text) => text.length > 0);
  return blocks.map((text, index) => ({ id: `b${index + 1}`, text }));
};
