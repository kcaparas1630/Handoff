// One place for provider prices. The evaluation script and the runtime spend cap both read these,
// so a rate change cannot make a budget and a cost report disagree.
//
// Anthropic list prices for Claude Opus 5, read 2026-06-24. Replace with the contracted rate
// before quoting a per-recording figure against the roadmap's US$0.02 budget.
export const ANTHROPIC_INPUT_USD_PER_MTOK = 5;
export const ANTHROPIC_OUTPUT_USD_PER_MTOK = 25;

// PLACEHOLDER, not a contracted Deepgram rate: no price has been confirmed for this project, so
// every transcription figure derived from it is an illustration until this constant is replaced.
export const DEEPGRAM_PLACEHOLDER_USD_PER_AUDIO_SECOND = 0.0001;

export interface ProviderRates {
  anthropicInputUsdPerMTok: number;
  anthropicOutputUsdPerMTok: number;
  transcriptionUsdPerAudioSecond: number;
}

export const PROVIDER_RATES: ProviderRates = {
  anthropicInputUsdPerMTok: ANTHROPIC_INPUT_USD_PER_MTOK,
  anthropicOutputUsdPerMTok: ANTHROPIC_OUTPUT_USD_PER_MTOK,
  transcriptionUsdPerAudioSecond: DEEPGRAM_PLACEHOLDER_USD_PER_AUDIO_SECOND,
};

export interface ProviderUsageTotals {
  tokensIn: number;
  tokensOut: number;
  audioSeconds: number;
}

/** An estimate from counted usage, not a provider invoice. Used by the cap and by the metrics. */
export function estimateProviderSpendUsd(
  totals: ProviderUsageTotals,
  rates: ProviderRates = PROVIDER_RATES,
): number {
  return (
    (totals.tokensIn / 1e6) * rates.anthropicInputUsdPerMTok +
    (totals.tokensOut / 1e6) * rates.anthropicOutputUsdPerMTok +
    totals.audioSeconds * rates.transcriptionUsdPerAudioSecond
  );
}
