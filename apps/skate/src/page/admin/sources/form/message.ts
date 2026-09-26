import { Dialog } from "@foldkit/ui";
import { Schema } from "effect";
import { defineMessageUnion } from "foldkit/message";
import { Sources } from "../../../../domain/sources";
import { UserId } from "../../../../domain/session";

export const Message = defineMessageUnion({
  UpdatedName: { value: Schema.String },
  UpdatedUrl: { value: Schema.String },
  UpdatedNotes: { value: Schema.String },
  SubmittedForm: {},
  GotDialogMessage: { message: Dialog.Message },
  CompletedCreateSource: {
    requestId: Schema.Number,
    scopeId: Schema.String,
    userId: UserId,
    result: Schema.Result(Sources.SourceRow, Sources.SourceError),
  },
});
export type Message = typeof Message.Type;

export const OutMessage = defineMessageUnion({
  SubmittedSource: { requestId: Schema.Number, input: Sources.CreateSource },
  CreatedSource: { requestId: Schema.Number, source: Sources.SourceRow },
  FailedCreateSource: { requestId: Schema.Number, error: Sources.SourceError },
});
export type OutMessage = typeof OutMessage.Type;
