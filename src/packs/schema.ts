import { z } from "zod";

/** pack.yaml schema (spec §8). A pack folder = a reusable, verifiable recipe. */
export const PackInputSchema = z.object({
  key: z.string(),
  prompt: z.string(),
  example: z.string().optional(),
});

export const PackVerifySchema = z.object({
  install: z.string(),
  build: z.string(),
  smoke: z.object({
    command: z.string(),
    assertUrl: z.string(),
    assertContains: z.string(),
  }),
});

export const PackSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  description: z.string(),
  inputs: z.array(PackInputSchema),
  requires: z.object({
    engine: z.string(),
    deployTarget: z.string(),
    database: z.string(),
  }),
  stack: z.object({
    frontend: z.string(),
    backend: z.string(),
    db: z.string(),
  }),
  verify: PackVerifySchema,
  prompts: z.object({
    build: z.string(),
    fixBuild: z.string(),
    fixDeploy: z.string(),
  }),
});

export type Pack = z.infer<typeof PackSchema>;
export type PackInput = z.infer<typeof PackInputSchema>;
