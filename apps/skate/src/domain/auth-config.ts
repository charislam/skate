import { ConfigProvider } from "effect";

export const layer = ConfigProvider.layer(
  ConfigProvider.fromUnknown({
    VITE_SUPABASE_URL: import.meta.env["VITE_SUPABASE_URL"],
    VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"],
  }),
);
