import { expect, it } from "vitest";
import { destination } from "./destinations";

it("covers audited HTML reflection aliases and tag-aware coupled fields without DOM mutation", () => {
  const cases: ReadonlyArray<readonly [keyof HTMLElementTagNameMap, string, string]> = [
    ["div", "className", "class"],
    ["label", "htmlFor", "for"],
    ["div", "tabIndex", "tabindex"],
    ["div", "ariaLabel", "aria-label"],
    ["div", "ariaAutoComplete", "aria-autocomplete"],
    ["div", "ariaActiveDescendantElement", "aria-activedescendant"],
    ["div", "ariaControlsElements", "aria-controls"],
    ["form", "acceptCharset", "accept-charset"],
    ["form", "encoding", "enctype"],
    ["form", "enctype", "enctype"],
    ["meta", "httpEquiv", "http-equiv"],
    ["td", "ch", "char"],
    ["td", "chOff", "charoff"],
    ["input", "defaultValue", "value"],
    ["input", "value", "value"],
    ["input", "valueAsDate", "value"],
    ["input", "valueAsNumber", "value"],
    ["input", "checked", "checked"],
    ["input", "defaultChecked", "checked"],
    ["textarea", "defaultValue", "value"],
    ["textarea", "value", "value"],
    ["option", "selected", "selected"],
    ["option", "defaultSelected", "selected"],
    ["output", "value", "value"],
    ["output", "defaultValue", "value"],
    ["select", "value", "selection"],
    ["select", "selectedIndex", "selection"],
    ["audio", "muted", "muted"],
    ["video", "defaultMuted", "muted"],
    ["a", "href", "href"],
    ["a", "hash", "href"],
    ["area", "pathname", "href"],
    ["input", "readOnly", "readonly"],
    ["input", "disabled", "disabled"],
    ["button", "formNoValidate", "formnovalidate"],
    ["button", "commandForElement", "commandfor"],
    ["button", "popoverTargetElement", "popovertarget"],
    ["input", "popoverTargetAction", "popovertargetaction"],
    ["div", "contentEditable", "contenteditable"],
    ["div", "spellcheck", "spellcheck"],
    ["img", "isMap", "ismap"],
    ["iframe", "allowFullscreen", "allowfullscreen"],
    ["link", "imageSrcset", "imagesrcset"],
    ["table", "cellPadding", "cellpadding"],
    ["td", "rowSpan", "rowspan"],
    ["template", "shadowRootMode", "shadowrootmode"],
    ["ol", "compact", "compact"],
    ["br", "clear", "clear"],
    ["h1", "align", "align"],
  ];
  for (const [tag, name, attribute] of cases) {
    const element = document.createElement(tag);
    const before = element.outerHTML;
    expect(destination({ element, kind: "property", name })).toBe(`attribute:${attribute}`);
    expect(destination({ element, kind: "attribute", name: attribute.toUpperCase() })).toBe(
      `attribute:${attribute}`,
    );
    expect(element.outerHTML).toBe(before);
  }
  const element = document.createElement("div");
  expect(destination({ element, kind: "property", name: "value" })).toBe("property:value");
  expect(destination({ element, kind: "property", name: "scrollTop" })).toBe("property:scrollTop");
});
