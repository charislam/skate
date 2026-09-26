import { Listbox } from "@foldkit/ui";
import { type Model, TypeListboxId } from "./model";

export const TypeListbox = Listbox.create<Model["type"]>();
export { TypeListboxId };
