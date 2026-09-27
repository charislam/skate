import { makeFieldQuestions } from "../domain/questions.ts";
import { makeWindow } from "../domain/window.ts";
import { normalizeHtml } from "../services/html-source.ts";

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

Deno.test("four week windows use consecutive seven day buckets across year change", () => {
  const window = makeWindow("2026-12-21");
  assert(
    window.endDateExclusive === "2027-01-18",
    "window end must be exclusive after 28 calendar days",
  );
  assert(
    window.weeks.length === 4 &&
      window.weeks.every((week) => week.length === 7),
    "window must contain four seven day weeks",
  );
  assert(
    window.weeks[2][0] === "2027-01-04",
    "week three must follow the prior seven day bucket",
  );
});

Deno.test("time choices contain 192 marks and one overlapping HH:30 choice", () => {
  const questions = makeFieldQuestions("fixture occurrence");
  const timeOptions = questions.start_time.type === "choice"
    ? Object.keys(questions.start_time.options)
    : [];
  assert(
    timeOptions.length === 195,
    "time options must contain 192 grid values and three sentinels",
  );
  assert(
    timeOptions.filter((value) => value.endsWith(":30")).length === 24,
    "each hour should contain one HH:30 option",
  );
  assert(
    timeOptions.includes("off_grid"),
    "off-grid time follow-up must be available",
  );
});

Deno.test("HTML normalization retains headings and table rows", () => {
  const blocks = normalizeHtml(
    "<html><body><nav>Menu</nav><h2>Public skating</h2><table><tr><th>Date</th><th>Time</th></tr><tr><td>Monday</td><td>Cancelled 6:00 PM</td></tr></table><script>bad()</script></body></html>",
  );
  assert(
    blocks.length === 3,
    "irrelevant navigation and scripts should be removed",
  );
  assert(
    blocks[0]?.text === "Public skating",
    "heading should survive normalization",
  );
  assert(
    blocks[1]?.text === "Date | Time",
    "table columns should remain associated in a row",
  );
  assert(
    blocks[2]?.text === "Monday | Cancelled 6:00 PM",
    "table cells should remain associated in a row",
  );
});
