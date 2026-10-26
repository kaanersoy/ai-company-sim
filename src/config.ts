import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface EmployeeSeed {
  id: string; role: string; salary: number;
  personality?: string;
  hiredDay?: number;
  adapting?: boolean; // true on the hire day: no productive work yet
}
export interface CustomerSpec {
  id: string; name: string; business: string;
  need: string;       // hidden: only revealed when the team asks
  payCap: number;     // most this customer finds the product worth per DAY (value = payCap*(avg/10)^1.5)
  everyDays: number;  // visits every N days
  firstDay: number;   // first visit day
}
export interface Config {
  maxSpendUsd: number;
  model: string;
  pricesPerMTok: { input: number; output: number };
  maxTokens: { manager: number; worker: number; customer: number; summary?: number };
  charsPerTokenEstimate: number;
  game: {
    startingBudget: number;
    officeRentPerDay?: number;
    maxDays: number;
    maxEmployees: number;
    hiringFee: number;
    severanceDays: number;
    maxSalary: number;
    spendCapPerAction: number;
    startPrice: number;    // initial daily subscription price
    minPrice: number; maxPrice: number;
    subscribeAvg: number;  // customer subscribes when avg score >= this (and price <= value)
    cancelAvg: number;     // subscriber cancels when avg score < this (or price > value)
    startingEmployees: EmployeeSeed[];
    seed?: number;         // fixes the product-idea inspiration (tests); omitted = random per world
  };
  customers: CustomerSpec[];
  dailyDebate: boolean;
  dbPath: string;
  mockDbPath: string;
}

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function loadConfig(): Config {
  return JSON.parse(readFileSync(path.join(ROOT, "config.json"), "utf8")) as Config;
}
