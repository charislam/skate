import { Effect } from "effect";
import { expect, it } from "vitest";
import { harness, rendered } from "./test-helpers";
import { Todos } from "./todos";

const run = Effect.runPromise;

it("adds, edits, completes, reorders, and deletes todos while preserving unsaved drafts", async () => {
  const { ctx, target, failures } = await harness();
  Effect.runSync(ctx.h(target, Todos));
  await rendered({
    parent: target,
    check: () => target.querySelector('[aria-label="New todo"]') !== null,
  });
  const newTodo = target.querySelector<HTMLInputElement>('[aria-label="New todo"]');
  const add = Array.from(target.querySelectorAll("button")).find(
    (button) => button.textContent === "Add todo",
  );
  for (const label of ["First", "Second"]) {
    newTodo?.setAttribute("data-test", label);
    Object.assign(newTodo ?? {}, { value: label });
    newTodo?.dispatchEvent(new Event("input", { bubbles: true }));
    add?.click();
    await rendered({
      parent: target,
      check: () =>
        Array.from(target.querySelectorAll("li span")).some((span) => span.textContent === label),
    });
  }
  const first = target.querySelector("li");
  const draft = first?.querySelector<HTMLInputElement>('[aria-label="Todo draft"]');
  Object.assign(draft ?? {}, { value: "Unsaved" });
  draft?.dispatchEvent(new Event("input", { bubbles: true }));
  first?.querySelector<HTMLInputElement>('[aria-label="Completed"]')?.click();
  await run(Effect.yieldNow);
  Array.from(first?.querySelectorAll("button") ?? [])
    .find((button) => button.textContent === "Move down")
    ?.click();
  await rendered({ parent: target, check: () => target.querySelectorAll("li")[1] === first });
  expect(draft?.value).toBe("Unsaved");
  expect(first?.querySelector("span")?.textContent).toBe("First");
  expect(first?.querySelector<HTMLInputElement>('[aria-label="Completed"]')?.checked).toBe(true);
  Array.from(first?.querySelectorAll("button") ?? [])
    .find((button) => button.textContent === "Save")
    ?.click();
  await rendered({
    parent: target,
    check: () => first?.querySelector("span")?.textContent === "Unsaved",
  });
  for (const item of Array.from(target.querySelectorAll("li"))) {
    Array.from(item.querySelectorAll("button"))
      .find((button) => button.textContent === "Delete")
      ?.click();
    await rendered({ parent: target, check: () => !target.contains(item) });
  }
  await rendered({
    parent: target,
    check: () => target.textContent?.includes("No todos yet.") === true,
  });
  expect(failures).toEqual([]);
});
