import type { z } from "zod";
import type { latestFactSchema, overviewDtoSchema } from "../schemas/overview";

export type LatestFact = z.infer<typeof latestFactSchema>;
export type OverviewDto = z.infer<typeof overviewDtoSchema>;
