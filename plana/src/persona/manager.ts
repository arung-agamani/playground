import { existsSync } from "node:fs";
import { join } from "node:path";
import type { PersonaDefinition } from "./types";
import { loadPersonaDir } from "./loader";

let currentPersona: PersonaDefinition | null = null;

export function loadPersona(dirPath: string): PersonaDefinition {
  const normalized = dirPath.endsWith("/") || dirPath.endsWith("\\")
    ? dirPath
    : dirPath;

  if (!existsSync(normalized)) {
    throw new Error(`Persona not found: ${normalized}`);
  }

  currentPersona = loadPersonaDir(normalized);
  return currentPersona;
}

export function getPersona(): PersonaDefinition {
  if (!currentPersona) {
    throw new Error("Persona not loaded. Call loadPersona() first.");
  }
  return currentPersona;
}
