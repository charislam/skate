import type { Auth } from "./domain/auth";
import type { Sources } from "./domain/sources";

export type Resource = Auth.Service | Sources.Service;
