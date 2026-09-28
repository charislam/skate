import {
  countOptions,
  countQuestionId,
  makeCountQuestion,
} from "../domain/questions.ts";
import { makeWindow, weekdayName } from "../domain/window.ts";
import { normalizeHtml } from "../services/html-source.ts";

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

Deno.test("28 day window advances local calendar dates across year boundaries", () => {
  const window = makeWindow("2026-12-21");
  assert(window.dates.length === 28, "window must contain 28 dates");
  assert(
    window.endDateExclusive === "2027-01-18",
    "exclusive end must be day 28",
  );
  assert(
    window.dates[0] === "2026-12-21" && window.dates[27] === "2027-01-17",
    "window includes today through day 27",
  );
  assert(weekdayName("2027-01-01") === "Friday", "weekday is computed");
});

Deno.test("count choices contain zero through fifty and the two sentinels", () => {
  const keys = Object.keys(countOptions);
  assert(keys.length === 53, "count question must have exactly 53 choices");
  assert(
    keys[0] === "0" && keys[50] === "50",
    "numeric choices must span 0 through 50",
  );
  assert(
    keys[51] === "more_than_50" && keys[52] === "unknown",
    "sentinels must be last",
  );
  assert(
    makeCountQuestion("2027-01-01").type === "choice",
    "daily count is a choice question",
  );
  assert(
    makeCountQuestion("2027-01-01").instructions.includes("Friday") &&
      countQuestionId("2027-01-01") === "count_2027-01-01",
    "each count question identifies its own date and weekday",
  );
  assert(
    new Set(makeWindow("2026-12-21").dates.map(countQuestionId)).size === 28,
    "the 28 daily questions have distinct IDs",
  );
});

Deno.test("cleaned HTML preserves schedule structure and semantic cancellation cues", () => {
  const html = normalizeHtml(
    "<!--drop--><html><body><script>bad()</script><div class='noise' onclick='bad()'><h2>Public skating</h2><p aria-label='Notice'>Season runs through April</p><table><caption>Schedule</caption><thead><tr><th scope='col' colspan='2'>Date and time</th></tr></thead><tbody><tr><td rowspan='2'>Monday</td><td><time datetime='18:00'>6:00 PM</time></td></tr><tr><td><del>Cancelled</del> <s>6:30 PM</s></td></tr></tbody></table><p>Exception: no skating on holidays.</p><svg><text>discard</text></svg></div></body></html>",
  );
  assert(
    !html.includes("bad()") && !html.includes("onclick") &&
      !html.includes("noise"),
    "scripts and presentation attributes are removed",
  );
  assert(
    !html.includes("<!--") && !html.includes("<svg"),
    "comments and graphics are removed",
  );
  assert(html.includes("<h2>Public skating</h2>"), "headings survive");
  assert(
    html.includes('scope="col"') && html.includes('colspan="2"') &&
      html.includes('rowspan="2"'),
    "table structure survives",
  );
  assert(
    html.includes('datetime="18:00"') &&
      html.includes("<del>Cancelled</del>") && html.includes("<s>6:30 PM</s>"),
    "time and cancellation cues survive",
  );
  assert(
    html.includes("Season runs through April") &&
      html.includes("Exception: no skating on holidays."),
    "notices and validity ranges survive",
  );
});
