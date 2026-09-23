import { Brand } from "effect";

export const API_URL = "https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/";

export type DatastoreId = string & Brand.Brand<"@inflow/city-datastore/DatastoreId">;

export const DatastoreId = Brand.nominal<DatastoreId>();

export const DATASTORE_ID_OUTDOOR_RINK = DatastoreId("e51b5d31-a53c-4fc5-a204-36c43243dd3b");

export * as CityDatastoreConstants from "./city-datastore-constants.js";
