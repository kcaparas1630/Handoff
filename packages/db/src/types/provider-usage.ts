/** A `provider_usage` row. `day` is a UTC calendar date, `YYYY-MM-DD`. */
export interface ProviderUsageRow {
  workspaceId: string;
  day: string;
  tokensIn: number;
  tokensOut: number;
  audioSeconds: number;
  updatedAt: Date;
}

export interface ProviderUsageDelta {
  workspaceId: string;
  day: string;
  tokensIn: number;
  tokensOut: number;
  audioSeconds: number;
}
