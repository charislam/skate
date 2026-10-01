import type { Clipboard as ClipboardService } from "@effect/platform-browser/Clipboard";
import type { Auth } from "./domain/auth";
import type { Calendar } from "./domain/calendar";
import type { Sources } from "./domain/sources";

export type Resource = Auth.Service | Sources.Service | Calendar.Service | ClipboardService;
