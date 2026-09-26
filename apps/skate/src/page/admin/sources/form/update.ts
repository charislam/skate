import { Dialog } from "@foldkit/ui";
import { Listbox } from "@foldkit/ui";
import { Effect, Option, Result, Schema } from "effect";
import { Command, FieldValidation, Update } from "foldkit";
import { evo } from "foldkit/struct";
import { Sources } from "../../../../domain/sources";
import { UserId } from "../../../../domain/session";
import type { Resource } from "../../../../resource";
import { Message, OutMessage } from "./message";
import { TypeListbox } from "./listbox";
import { type Model, init } from "./model";
import { nameRules, urlRules, validateName, validateUrl } from "./validation";

export type Context = Readonly<{ userId: UserId; scopeId: string; isAllowed: boolean }>;

export const CreateSource = Command.define("CreateSource", {
  args: {
    input: Sources.CreateSource,
    requestId: Schema.Number,
    scopeId: Schema.String,
    userId: UserId,
  },
  messages: [Message.CompletedCreateSource],
  execute: ({ input, requestId, scopeId, userId }) =>
    Effect.gen(function* () {
      const sources = yield* Sources.Service;
      const result = yield* Effect.result(sources.create(input));
      return Message.CompletedCreateSource({ requestId, scopeId, userId, result });
    }),
});

const dialogFold = {
  foldOutMessage: (outMessage: Dialog.OutMessage): Update.Step<Model, Message> =>
    Dialog.OutMessage.match(outMessage, {
      Opened: () => (model) => ({ model }),
      Closed: () => (model) => ({ model }),
    }),
  read: (model: Model) => Option.some(model.dialog),
  write: (model: Model, nextDialog: Dialog.Model) => evo(model, { dialog: () => nextDialog }),
  toParentMessage: (message: Dialog.Message) => Message.GotDialogMessage({ message }),
};
const foldDialog = Update.foldChild({ ...dialogFold, update: Dialog.update });
const closeDialog = Update.foldChildStep({ ...dialogFold, update: Dialog.close });
const openDialog = Update.foldChildStep({ ...dialogFold, update: Dialog.open });
const typeListboxFold = Update.foldChild({
  update: TypeListbox.update,
  read: (model: Model) => Option.some(model.typeListbox),
  write: (model, nextListbox) => evo(model, { typeListbox: () => nextListbox }),
  toParentMessage: (message) => Message.GotTypeListboxMessage({ message }),
  foldOutMessage: Listbox.OutMessage.match<
    Update.Step<Model, Message>,
    Listbox.OutMessage<Model["type"]>
  >({
    Selected: () => (model) => ({ model }),
  }),
});

export const open = (model: Model) => {
  if (model.dialog.isOpen) {
    return { model };
  }
  return openDialog(
    evo(init(), {
      dialog: () => model.dialog,
      nextRequestId: () => model.nextRequestId,
      pendingRequestIds: () => model.pendingRequestIds,
    }),
  );
};

export const update = (model: Model, message: Message, context: Context) =>
  Message.match<Update.ReturnWithOutMessage<Model, Message, OutMessage, Resource>>(message, {
    UpdatedName: ({ value }) => ({
      model: evo(model, { name: () => FieldValidation.NotValidated({ value }) }),
    }),
    UpdatedUrl: ({ value }) => ({
      model: evo(model, { url: () => FieldValidation.NotValidated({ value }) }),
    }),
    UpdatedNotes: ({ value }) => ({
      model: evo(model, { notes: () => FieldValidation.NotValidated({ value }) }),
    }),
    GotDialogMessage: ({ message: dialogMessage }) => foldDialog(model, dialogMessage),
    GotTypeListboxMessage: ({ message: listboxMessage }) => typeListboxFold(model, listboxMessage),
    SubmittedForm: () => {
      if (!context.isAllowed || !model.dialog.isOpen) {
        return { model };
      }
      const name = validateName(model.name.value.trim());
      const url = validateUrl(model.type, model.url.value.trim());
      const validated = evo(model, { name: () => name, url: () => url });
      if (
        !FieldValidation.allValid([
          [name, nameRules],
          [url, urlRules],
        ])
      ) {
        return { model: validated };
      }
      const requestId = model.nextRequestId;
      const input: Sources.CreateSource = {
        name: name.value,
        type: model.type,
        url: url.value,
        notes: Option.fromNullishOr(model.notes.value.trim() || null),
      };
      const submission = Update.combine(validated, [
        (stepModel: Model): Update.Return<Model, Message, Resource> => ({
          model: evo(stepModel, {
            pendingRequestIds: (ids) => [...ids, requestId],
            nextRequestId: () => requestId + 1,
          }),
          commands: [
            CreateSource({ requestId, scopeId: context.scopeId, userId: context.userId, input }),
          ],
        }),
        closeDialog,
      ]);
      return Update.withOutMessage(submission, OutMessage.SubmittedSource({ requestId, input }));
    },
    CompletedCreateSource: (completion) => {
      if (
        completion.scopeId !== context.scopeId ||
        completion.userId !== context.userId ||
        !model.pendingRequestIds.includes(completion.requestId)
      ) {
        return { model };
      }
      const settled = evo(model, {
        pendingRequestIds: (ids) => ids.filter((id) => id !== completion.requestId),
      });
      return {
        model: settled,
        outMessage: Result.match(completion.result, {
          onFailure: (error) =>
            OutMessage.FailedCreateSource({ requestId: completion.requestId, error }),
          onSuccess: (source) =>
            OutMessage.CreatedSource({ requestId: completion.requestId, source }),
        }),
      };
    },
  });
