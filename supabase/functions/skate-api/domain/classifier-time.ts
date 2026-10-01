import { Option } from "effect";

const canonicalHours = {
  "12 AM": "00",
  "1 AM": "01",
  "2 AM": "02",
  "3 AM": "03",
  "4 AM": "04",
  "5 AM": "05",
  "6 AM": "06",
  "7 AM": "07",
  "8 AM": "08",
  "9 AM": "09",
  "10 AM": "10",
  "11 AM": "11",
  "12 PM": "12",
  "1 PM": "13",
  "2 PM": "14",
  "3 PM": "15",
  "4 PM": "16",
  "5 PM": "17",
  "6 PM": "18",
  "7 PM": "19",
  "8 PM": "20",
  "9 PM": "21",
  "10 PM": "22",
  "11 PM": "23",
};

const hourMapping = new Map(Object.entries(canonicalHours));
const timeMapping = new Map(
  Object.entries(canonicalHours).flatMap(([choice, hour]) =>
    ["00", "10", "15", "20", "30", "40", "45", "50"].map((minute) =>
      [
        choice.replace(" ", `:${minute} `),
        `${hour}:${minute}`,
      ] as const
    )
  ),
);

export const timeOptions = Object.fromEntries([
  ...Array.from(timeMapping.keys(), (choice) => [
    choice,
    `Local clock time ${choice}`,
  ]),
  ["off_grid", "An exact stated time outside the listed marks"],
  ["not_stated", "No time is stated"],
  ["unclear", "The time cannot be determined"],
]);

export const hourOptions = Object.fromEntries([
  ...Array.from(hourMapping.keys(), (choice) => [choice, `Hour ${choice}`]),
  ["unknown", "Unknown hour"],
]);

export const decodeTimeChoice = (choice: string): Option.Option<string> =>
  Option.fromNullishOr(timeMapping.get(choice));

export const decodeExactTime = ({ hour, minute }: {
  readonly hour: string;
  readonly minute: string;
}): Option.Option<string> =>
  /^[0-5]\d$/.test(minute)
    ? Option.map(
      Option.fromNullishOr(hourMapping.get(hour)),
      (canonicalHour) => `${canonicalHour}:${minute}`,
    )
    : Option.none();
