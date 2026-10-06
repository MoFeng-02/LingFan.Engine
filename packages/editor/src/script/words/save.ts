/**
 * Script 词汇层 · **存档域**（save / load / auto_save / save_delete）。
 */
import type { CommandOf } from "../../schema/opSchemas";

export function save(slot: string, title?: string): CommandOf<"save"> {
  return { op: "save", slot, ...(title === undefined ? {} : { title }) };
}

export function load(slot: string): CommandOf<"load"> {
  return { op: "load", slot };
}

export function autoSave(enabled: boolean): CommandOf<"auto_save"> {
  return { op: "auto_save", enabled };
}

export function saveDelete(slot: string): CommandOf<"save_delete"> {
  return { op: "save_delete", slot };
}
