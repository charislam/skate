import { Context, Effect } from "effect";
import { makeHandler } from "../app.ts";

Deno.test("Effect web handler registers the function prefix and rejects unrecognized credentials", async () => {
  const original = {
    supabaseUrl: Deno.env.get("SUPABASE_URL"),
    secretKeys: Deno.env.get("SUPABASE_SECRET_KEYS"),
    keyName: Deno.env.get("SKATE_API_KEY_NAME"),
    typesafeKey: Deno.env.get("TYPESAFE_API_KEY"),
  };
  Deno.env.set("SUPABASE_URL", "http://127.0.0.1:54321");
  Deno.env.set("SUPABASE_SECRET_KEYS", '{"default":"sb_secret_test_key"}');
  Deno.env.set("SKATE_API_KEY_NAME", "default");
  Deno.env.set("TYPESAFE_API_KEY", "typesafe_test_key");

  const webHandler = await Effect.runPromise(makeHandler);
  try {
    const response = await webHandler.handler(
      new Request("http://localhost/skate-api/source/scrape", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: "sb_secret_unrecognized",
        },
        body: JSON.stringify({ sourceId: "123" }),
      }),
      Context.empty(),
    );
    if (response.status !== 401) {
      throw new Error(
        `Expected 401 for unrecognized key; got ${response.status}`,
      );
    }
  } finally {
    await webHandler.dispose();
    restore("SUPABASE_URL", original.supabaseUrl);
    restore("SUPABASE_SECRET_KEYS", original.secretKeys);
    restore("SKATE_API_KEY_NAME", original.keyName);
    restore("TYPESAFE_API_KEY", original.typesafeKey);
  }
});

const restore = (key: string, value: string | undefined): void => {
  if (value === undefined) {
    Deno.env.delete(key);
  } else {
    Deno.env.set(key, value);
  }
};
