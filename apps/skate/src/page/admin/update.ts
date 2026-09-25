import { AsyncData, type Update } from "foldkit";
import { Option, Result } from "effect";
import { evo } from "foldkit/struct";
import { Message, OutMessage } from "./message";
import { Model } from "./model";
import { FetchActiveSources, FetchAdminAccess } from "./command";
import { UserId } from "../../domain/session";
import type { Resource } from "../../resource";
import type { AdminSection } from "../../route";

export type Context = Readonly<{ userId: UserId }>;
export const update = (model: Model, message: Message, context: Context) =>
  Message.match<Update.ReturnWithOutMessage<Model, Message, OutMessage, Resource>>(message, {
    ClickedRetryAccess: () => revalidateAccess(model, context),
    InvalidatedAccess: () => revalidateAccess(model, context),
    ClickedLogout: () => ({ model, outMessage: OutMessage.RequestedLogout() }),
    ToggledNavigation: ({ isOpen }) => ({
      model: evo(model, { isNavigationOpen: () => isOpen }),
    }),
    SettledFetchAccess: ({ userId, adminRequestId, result }) => {
      if (
        context.userId !== userId ||
        model.adminRequestId !== adminRequestId ||
        !AsyncData.isPending(model.adminAccess)
      ) {
        return { model };
      }
      return {
        model: evo(model, { adminAccess: AsyncData.settle(result) }),
        ...(Result.isSuccess(result) && !result.success
          ? { outMessage: OutMessage.DeniedAccess() }
          : {}),
      };
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
        model: evo(model, { adminAccess: () => adminAccess, adminRequestId: () => adminRequestId }),
        commands: [FetchAdminAccess({ userId: context.userId, adminRequestId })],
      };
    },
  });

export const enterSection = (
  model: Model,
  section: AdminSection,
): Update.Return<Model, Message, Resource> =>
  section === "Overview" ? loadActiveSources(model) : { model };

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
