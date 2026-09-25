import { Toast as UiToast } from "@foldkit/ui";
import { Schema } from "effect";

export type { ShowInput } from "@foldkit/ui/toast";
export const Toast = UiToast.make(Schema.String);
