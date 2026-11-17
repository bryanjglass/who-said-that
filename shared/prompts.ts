/**
 * Question bank. Prompts live in shared/data/prompts.json (see docs/PROMPTS.md
 * for the format). They are validated at load time so a bad edit fails fast.
 */
import bank from "./data/prompts.json";
import { CATEGORIES, type Category } from "./constants";
import type { Prompt } from "./engine/state";

export interface PromptBankFile {
  version: number;
  prompts: { id: string; category: string; text: string }[];
}

export function validatePromptBank(file: PromptBankFile): { prompts: Prompt[]; errors: string[] } {
  const errors: string[] = [];
  const ids = new Set<string>();
  const texts = new Set<string>();
  const prompts: Prompt[] = [];
  if (file.version !== 1) errors.push(`Unsupported prompt bank version: ${file.version}`);
  for (const [i, p] of (file.prompts ?? []).entries()) {
    const where = `prompts[${i}] (${p?.id ?? "no id"})`;
    if (!p || typeof p.id !== "string" || !/^[a-z0-9-]{1,40}$/.test(p.id)) {
      errors.push(`${where}: id must be 1-40 chars of a-z, 0-9, '-'`);
      continue;
    }
    if (ids.has(p.id)) errors.push(`${where}: duplicate id`);
    ids.add(p.id);
    if (!CATEGORIES.includes(p.category as Category)) errors.push(`${where}: unknown category "${p.category}"`);
    const text = typeof p.text === "string" ? p.text.trim() : "";
    if (text.length < 10 || text.length > 120) errors.push(`${where}: text must be 10-120 characters`);
    const key = text.toLowerCase();
    if (texts.has(key)) errors.push(`${where}: duplicate text`);
    texts.add(key);
    prompts.push({ id: p.id, category: p.category as Category, text });
  }
  return { prompts, errors };
}

const loaded = validatePromptBank(bank as PromptBankFile);
if (loaded.errors.length) {
  throw new Error(`Invalid prompt bank:\n${loaded.errors.join("\n")}`);
}

export const PROMPTS: readonly Prompt[] = Object.freeze(loaded.prompts);
