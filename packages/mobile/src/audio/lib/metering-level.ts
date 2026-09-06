// expo-audio reports metering in dBFS, where 0 is the loudest the microphone can register and
// quiet speech sits near -40. The indicator only needs a restrained 0-1 level, never a waveform.
const QUIET_DBFS = -60;

export function normaliseMeteringLevel(metering: number | undefined): number | null {
  if (metering === undefined || !Number.isFinite(metering)) return null;
  const level = (metering - QUIET_DBFS) / -QUIET_DBFS;
  if (level <= 0) return 0;
  return level >= 1 ? 1 : level;
}
