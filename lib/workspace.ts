import { z } from "zod";
import { PlantSchema } from "./model";
export const DrawingSchema = z.object({
  image: z
    .string()
    .regex(
      /^(data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$|\/fixtures\/(clear|alternate|ambiguous)\.svg$)/,
    ),
  name: z.string().max(200),
  page: z.number().int().positive(),
  pages: z.number().int().positive().max(10000),
  width: z.number().int().positive().max(10000),
  height: z.number().int().positive().max(10000),
});
export const WorkspaceSchema = z.object({
  model: PlantSchema.nullable(),
  drawing: DrawingSchema.nullable(),
});
