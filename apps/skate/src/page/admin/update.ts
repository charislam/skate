import { AsyncData, Update } from "foldkit";
import { Option, Result } from "effect";
import { evo } from "foldkit/struct";
import { Message, OutMessage } from "./message";
import { Model } from "./model";
import { FetchActiveSources, FetchAdminAccess } from "./command";
import { UserId } from "../../domain/session";
import { Message as ParentMessage } from "./message";
import { canAccessAdmin } from "../../domain/admin-access";
import type { Resource } from "../../resource";
import type { AdminSection } from "../../route";
import * as SourcesTable from "./sources/model";
import * as SourcesTableMessage from "./sources/message";
import { enter as enterSourcesTable, update as updateSourcesTable } from "./sources/update";

export type Context = Readonly<{
  userId: UserId;
  maybeAdminSection: Option.Option<AdminSection>;
}>;

const foldSourcesTable = Update.foldChild({
  update: (
    sourcesTable: SourcesTable.Model,
    input: { message: SourcesTableMessage.Message; context: Context; isAllowed: boolean },
  ) =>
    updateSourcesTable(sourcesTable, input.message, {
      userId: input.context.userId,
      isAllowed: input.isAllowed,
    }),
  read: (model: Model) => Option.some(model.sourcesTable),
  write: (model: Model, nextSourcesTable: SourcesTable.Model) =>
    evo(model, { sourcesTable: () => nextSourcesTable }),
  toParentMessage: (message) => ParentMessage.GotSourcesTableMessage({ message }),
});

const foldEnterSourcesTable = Update.foldChild({
  update: (sourcesTable: SourcesTable.Model, input: { userId: UserId; isAllowed: boolean }) =>
    enterSourcesTable(sourcesTable, input),
  read: (model: Model) => Option.some(model.sourcesTable),
  write: (model: Model, nextSourcesTable: SourcesTable.Model) =>
    evo(model, { sourcesTable: () => nextSourcesTable }),
  toParentMessage: (message) => ParentMessage.GotSourcesTableMessage({ message }),
});

const foldDenyAccessAndEnterSourcesTable = (
  model: Model,
  userId: UserId,
): Update.ReturnWithOutMessage<Model, Message, OutMessage, Resource> =>
  Update.withOutMessage(
    foldEnterSourcesTable(model, { userId, isAllowed: false }),
    OutMessage.DeniedAccess(),
  );

export const update = (model: Model, message: Message, context: Context) =>
  Message.match<Update.ReturnWithOutMessage<Model, Message, OutMessage, Resource>>(message, {
    ClickedRetryAccess: () => revalidateAccess(model, context),
    InvalidatedAccess: () => revalidateAccess(model, context),
    ClickedLogout: () => ({ model, outMessage: OutMessage.RequestedLogout() }),
    ToggledNavigation: ({ isOpen }) => ({
      model: evo(model, { isNavigationOpen: () => isOpen }),
    }),
    GotSourcesTableMessage: ({ message: childMessage }) =>
      foldSourcesTable(model, {
        message: childMessage,
        context,
        isAllowed: canAccessAdmin(model.adminAccess),
      }),
    SettledFetchAccess: ({ userId, adminRequestId, result }) => {
      if (
        context.userId !== userId ||
        model.adminRequestId !== adminRequestId ||
        !AsyncData.isPending(model.adminAccess)
      ) {
        return { model };
      }
      const accessModel = evo(model, { adminAccess: AsyncData.settle(result) });
      if (
        Result.isSuccess(result) &&
        result.success &&
        Option.contains(context.maybeAdminSection, "Sources")
      ) {
        return foldEnterSourcesTable(accessModel, { userId, isAllowed: true });
      }
      if (Result.isFailure(result)) {
        return { model: accessModel };
      }
      if (!result.success) {
        return foldDenyAccessAndEnterSourcesTable(accessModel, context.userId);
      }
      return { model: accessModel };
    },
    SettledFetchActiveSources: ({ sourceRequestId, result }) => {
      if (
        model.sourceRequestId !== sourceRequestId ||
        !AsyncData.isPending(model.activeSourceCount)
      ) {
        return { model };
      }
      return { model: evo(model, { activeSourceCount: AsyncData.settle(result) }) };
    },
  });

export const revalidateAccess = (
  model: Model,
  context: Context,
): Update.ReturnWithOutMessage<Model, Message, OutMessage, Resource> =>
  Option.match(AsyncData.revalidateOrLoad(model.adminAccess), {
    onNone: () => ({ model }),
    onSome: (adminAccess) => {
      const adminRequestId = model.adminRequestId + 1;
      return {
        model: evo(model, {
          adminAccess: () => adminAccess,
          adminRequestId: () => adminRequestId,
        }),
        commands: [FetchAdminAccess({ userId: context.userId, adminRequestId })],
      };
    },
  });

export const enterSection = (
  model: Model,
  section: AdminSection,
  context?: Pick<Context, "userId">,
): Update.Return<Model, Message, Resource> => {
  if (section === "Overview") {
    return loadActiveSources(model);
  }
  if (!context || !canAccessAdmin(model.adminAccess)) return { model };
  return foldEnterSourcesTable(model, { userId: context.userId, isAllowed: true });
};

const loadActiveSources = (model: Model): Update.Return<Model, Message, Resource> =>
  Option.match(AsyncData.loadIfMissing(model.activeSourceCount), {
    onNone: () => ({ model }),
    onSome: (activeSourceCount) => {
      const sourceRequestId = model.sourceRequestId + 1;
      return {
        model: evo(model, {
          activeSourceCount: () => activeSourceCount,
          sourceRequestId: () => sourceRequestId,
        }),
        commands: [FetchActiveSources({ sourceRequestId })],
      };
    },
  });
