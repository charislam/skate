import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { Tabs } from "./tabs";
import { harness, rendered } from "./test-helpers";

const tabsHarness = async () => {
  const h = await harness();
  document.body.append(h.parent);
  Effect.runSync(h.ctx.h(h.target, [Tabs, Tabs]));
  await rendered({
    parent: h.parent,
    check: () => h.parent.querySelectorAll(".tabs").length === 2,
  });
  const sections = Array.from(h.parent.querySelectorAll(".tabs"));
  const left = sections[0] ?? document.createElement("section");
  const buttons = Array.from(left.querySelectorAll<HTMLButtonElement>("[role=tab]"));
  const panels = Array.from(left.querySelectorAll<HTMLElement>("[role=tabpanel]"));
  return { ...h, left, sections, buttons, panels };
};

describe("manual accessible tabs", () => {
  it("uses occurrence-unique ARIA relationships, stable panels, and independent selection", async () => {
    const { parent, sections, buttons, panels } = await tabsHarness();
    const allTabs = Array.from(parent.querySelectorAll<HTMLButtonElement>("[role=tab]"));
    expect(new Set(allTabs.map((tab) => tab.id)).size).toBe(6);
    expect(buttons.map((tab) => tab.textContent)).toEqual(["Overview", "Details", "Settings"]);
    expect(buttons.map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
    expect(buttons.map((tab) => tab.getAttribute("aria-selected"))).toEqual([
      "true",
      "false",
      "false",
    ]);
    expect(panels.map((panel) => panel.hidden)).toEqual([false, true, true]);
    for (const tab of allTabs) {
      const panel = parent.querySelector<HTMLElement>(`#${tab.getAttribute("aria-controls")}`);
      expect(panel?.getAttribute("aria-labelledby")).toBe(tab.id);
      expect(panel?.tabIndex).toBe(0);
      expect(tab.type).toBe("button");
    }
    expect(
      Array.from(parent.querySelectorAll("[role=tablist]")).every((list) =>
        list.hasAttribute("aria-label"),
      ),
    ).toBe(true);
    buttons[2]?.click();
    await rendered({ parent, check: () => buttons[2]?.getAttribute("aria-selected") === "true" });
    expect(buttons.map((tab) => tab.tabIndex)).toEqual([-1, -1, 0]);
    expect(panels.map((panel) => panel.hidden)).toEqual([true, true, false]);
    expect(document.activeElement).toBe(buttons[2]);
    expect(buttons[2]?.classList.contains("selected")).toBe(true);
    expect(sections[0]?.querySelectorAll("[role=tabpanel]")).toEqual(
      expect.objectContaining({ length: 3 }),
    );
    expect(Array.from(sections[0]?.querySelectorAll("[role=tabpanel]") ?? [])).toEqual(panels);
    expect(Array.from(sections[0]?.querySelectorAll("[role=tab]") ?? [])).toEqual(buttons);
    expect(sections[1]?.querySelector("[role=tab]")?.getAttribute("aria-selected")).toBe("true");
    parent.remove();
  });

  it("prevents navigation scrolling synchronously, wraps focus, and keeps activation manual", async () => {
    const { parent, buttons, panels } = await tabsHarness();
    buttons[0]?.focus();
    const press = async (options: { from: number; key: string; to: number }) => {
      const event = new KeyboardEvent("keydown", {
        key: options.key,
        bubbles: true,
        cancelable: true,
      });
      buttons[options.from]?.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      await rendered({ parent, check: () => buttons[options.to]?.tabIndex === 0 });
      expect(document.activeElement).toBe(buttons[options.to]);
      expect(buttons[0]?.getAttribute("aria-selected")).toBe("true");
      expect(panels.map((panel) => panel.hidden)).toEqual([false, true, true]);
    };
    await press({ from: 0, key: "ArrowLeft", to: 2 });
    await press({ from: 2, key: "ArrowRight", to: 0 });
    await press({ from: 0, key: "End", to: 2 });
    await press({ from: 2, key: "Home", to: 0 });
    await press({ from: 0, key: "ArrowRight", to: 1 });
    for (const key of ["Tab", "Enter", " "]) {
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      buttons[1]?.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    buttons[1]?.click();
    await rendered({ parent, check: () => buttons[1]?.getAttribute("aria-selected") === "true" });
    expect(panels.map((panel) => panel.hidden)).toEqual([true, false, true]);
    parent.remove();
  });
});
