import { Context, Effect, Scope } from "effect";
import { DOMParser, Node } from "linkedom";
import {
  SourceContentTooLarge,
  SourceFailure,
  UnsafeSourceUrl,
} from "../domain/source.ts";

export interface HtmlDocument {
  readonly fetchedAt: string;
  readonly html: string;
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

const contentTags = new Set([
  "html",
  "head",
  "body",
  "main",
  "section",
  "article",
  "aside",
  "div",
  "span",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "ul",
  "ol",
  "li",
  "br",
  "table",
  "caption",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "dl",
  "dt",
  "dd",
  "time",
  "strong",
  "em",
  "b",
  "i",
  "del",
  "s",
  "small",
  "a",
]);
const discardTags =
  "script,style,noscript,iframe,frame,frameset,object,embed,svg,canvas,template";
const NodeType = Node as unknown as {
  readonly COMMENT_NODE: number;
  readonly ELEMENT_NODE: number;
};

interface CleanNode {
  readonly nodeType: number;
  readonly tagName?: string;
  readonly childNodes: ArrayLike<CleanNode>;
  readonly attributes?: ArrayLike<{ readonly name: string }>;
  remove(): void;
  replaceWith(...nodes: Array<unknown>): void;
  getAttribute(name: string): string | null;
  removeAttribute(name: string): void;
}

interface CleanDocument extends CleanNode {
  readonly body?: { readonly innerHTML: string };
  readonly documentElement?: { readonly innerHTML: string };
  createTextNode(value: string): unknown;
  querySelectorAll(selector: string): ArrayLike<CleanNode>;
}

/** Removes executable, embedded, and presentation content while retaining schedule structure and semantic text. */
export const normalizeHtml = (html: string): string => {
  const document = new DOMParser().parseFromString(
    html,
    "text/html",
  ) as unknown as CleanDocument;
  for (const node of Array.from(document.querySelectorAll(discardTags))) {
    node.remove();
  }
  const visit = (node: CleanNode): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === NodeType.COMMENT_NODE) {
        child.remove();
        continue;
      }
      if (child.nodeType !== NodeType.ELEMENT_NODE) continue;
      const element = child;
      visit(element);
      const tag = element.tagName?.toLowerCase() ?? "";
      if (!contentTags.has(tag)) {
        const accessible = element.getAttribute("aria-label") ??
          element.getAttribute("title");
        if (accessible) {
          element.replaceWith(document.createTextNode(accessible));
        } else element.replaceWith(...Array.from(element.childNodes));
        continue;
      }
      for (
        const attribute of Array.from(element.attributes ?? [])
      ) {
        const name = String(attribute.name).toLowerCase();
        if (
          !(new Set([
            "rowspan",
            "colspan",
            "scope",
            "datetime",
            "aria-label",
            "title",
          ])).has(name)
        ) element.removeAttribute(name);
      }
    }
  };
  visit(document);
  return document.body?.innerHTML ?? document.documentElement?.innerHTML ?? "";
};
