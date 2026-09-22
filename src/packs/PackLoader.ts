import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { PackSchema, type Pack, type PackInput } from "./schema.js";

export interface RenderedPack {
  pack: Pack;
  /** the build prompt with {{inputs}} substituted */
  buildPrompt: string;
  fixBuildTemplate: string;
  fixDeployTemplate: string;
}

/**
 * Loads + validates a pack folder, resolves its prompt files. This is the whole
 * extension mechanism — a contributor adds a folder, no core changes (spec §8).
 */
export class PackLoader {
  constructor(private readonly packsRoot: string) {}

  async load(packId: string): Promise<Pack> {
    const dir = join(this.packsRoot, packId);
    const raw = await readFile(join(dir, "pack.yaml"), "utf8");
    const parsed = parseYaml(raw);
    return PackSchema.parse(parsed);
  }

  /** Render a pack's prompts against user inputs (+ later, error context). */
  async render(
    packId: string,
    inputs: Record<string, string>,
  ): Promise<RenderedPack> {
    const dir = join(this.packsRoot, packId);
    const pack = await this.load(packId);
    this.assertInputs(pack.inputs, inputs);

    const buildRaw = await readFile(join(dir, pack.prompts.build), "utf8");
    const fixBuildTemplate = await readFile(join(dir, pack.prompts.fixBuild), "utf8");
    const fixDeployTemplate = await readFile(join(dir, pack.prompts.fixDeploy), "utf8");

    return {
      pack,
      buildPrompt: interpolate(buildRaw, inputs),
      fixBuildTemplate,
      fixDeployTemplate,
    };
  }

  private assertInputs(defs: PackInput[], inputs: Record<string, string>): void {
    for (const def of defs) {
      if (!inputs[def.key]) {
        throw new Error(`Missing required input "${def.key}"`);
      }
    }
  }
}

/** Simple {{key}} substitution — no logic, deliberately dumb (spec §8). */
export function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) =>
    key in vars ? vars[key] ?? "" : `{{${key}}}`,
  );
}
