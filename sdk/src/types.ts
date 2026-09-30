import type { components } from "./generated/schema.js";

type Schemas = components["schemas"];

export type Grams = Schemas["Grams"];
export type Pkr = Schemas["Pkr"];
export type Health = Schemas["Health"];
export type Price = Schemas["Price"];
export type RegisterWalletRequest = Schemas["RegisterWalletRequest"];
export type Wallet = Schemas["Wallet"];
export type Balance = Schemas["Balance"];
export type QuoteRequest = Schemas["QuoteRequest"];
export type Quote = Schemas["Quote"];
export type Fees = Schemas["Fees"];
export type TransferRequest = Schemas["TransferRequest"];
export type Transaction = Schemas["Transaction"];
export type TransactionStatus = Transaction["status"];
export type TransactionList = Schemas["TransactionList"];
export type Reserve = Schemas["Reserve"];
export type TransactionEvent = Schemas["TransactionEvent"];
export type ApiErrorBody = Schemas["Error"];
export type ErrorCode = ApiErrorBody["error"]["code"];
