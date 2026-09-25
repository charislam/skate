import { AsyncData, type Update } from "foldkit";
import { Option, Result } from "effect";
import { evo } from "foldkit/struct";
import { Message, OutMessage } from "./message";
import { Model } from "./model";
import { FetchAdminAccess } from "./command";
import { Auth } from "../../domain/auth";
import { UserId } from "../../domain/session";

export type Context = Readonly<{ userId: UserId }>;

export const update = (model: Model, message: Message, context: Context) =>
  Message.match<Update.ReturnWithOutMessage<Model, Message, OutMessage, Auth.Service>>(message, {
    ClickedRetryAccess: () => revalidate(model, context),
    InvalidatedAccess: () => revalidate(model, context),
    ClickedLogout: () => ({ model, outMessage: OutMessage.RequestedLogout() }),
    SettledFetchAccess: ({ userId, requestId, result }) => {
      if (
        context.userId !== userId ||
        model.requestId !== requestId ||
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
  });

export const revalidate = (
  model: Model,
  context: Context,
): Update.ReturnWithOutMessage<Model, Message, OutMessage, Auth.Service> =>
  Option.match(AsyncData.revalidateOrLoad(model.adminAccess), {
    onNone: () => ({ model }),
    onSome: (adminAccess) => {
      const requestId = model.requestId + 1;
      return {
        model: evo(model, { adminAccess: () => adminAccess, requestId: () => requestId }),
        commands: [FetchAdminAccess({ userId: context.userId, requestId })],
      };
    },
  });

export const invalidate = (model: Model, context: Context) => revalidate(model, context);
