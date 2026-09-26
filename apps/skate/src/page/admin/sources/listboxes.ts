import { Listbox } from "@foldkit/ui";
import * as Form from "./form/model";

export const EnabledFilterListbox = Listbox.create<"all" | "true" | "false">();
export const TypeFilterListbox = Listbox.create<"all" | Form.SourceType>();
export const FetchStatusFilterListbox = Listbox.create<"all" | "never" | "fetched">();

export const EnabledFilterListboxId = "enabled-filter-listbox";
export const TypeFilterListboxId = "type-filter-listbox";
export const FetchStatusFilterListboxId = "fetch-status-filter-listbox";
