<#
.SYNOPSIS
Regenerates the synthetic evaluation recordings listed in tests/fixtures/audio/manifest.json.

.DESCRIPTION
Speaks each entry's expectedTranscript with a Windows SAPI voice and writes 16 kHz mono PCM WAV
files under tests/fixtures/audio. These clips are machine voices: they exercise the recording,
upload, transcription, and extraction pipeline, not accent or noise robustness. No real child or
caregiver audio belongs in this directory.

Run from anywhere:
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/generate-audio-fixtures.ps1
#>

[CmdletBinding()]
param(
    [switch]$Force
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Speech

$fixturesRoot = Join-Path (Split-Path -Parent $PSScriptRoot) "tests\fixtures"
$manifestPath = Join-Path $fixturesRoot "audio\manifest.json"
if (-not (Test-Path $manifestPath)) {
    throw "Manifest not found at $manifestPath"
}

$entries = Get-Content -Path $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$installed = $synth.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name }

# 16 kHz mono matches the sample rate speech recognition providers downsample to anyway.
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(
    16000,
    [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
    [System.Speech.AudioFormat.AudioChannel]::Mono)

try {
    foreach ($entry in $entries) {
        $target = Join-Path $fixturesRoot ($entry.file -replace "/", "\")
        $targetDir = Split-Path -Parent $target
        if (-not (Test-Path $targetDir)) {
            New-Item -ItemType Directory -Path $targetDir | Out-Null
        }
        if ((Test-Path $target) -and -not $Force) {
            Write-Output "skip  $($entry.file) (already present; pass -Force to rebuild)"
            continue
        }

        if ($installed -contains $entry.voice) {
            $synth.SelectVoice($entry.voice)
        }
        else {
            Write-Warning "Voice '$($entry.voice)' is not installed; using $($synth.Voice.Name) for $($entry.caseId)"
        }

        $synth.SetOutputToWaveFile($target, $format)
        $synth.Speak($entry.expectedTranscript)
        $synth.SetOutputToNull()
        Write-Output "write $($entry.file) [$($synth.Voice.Name)]"
    }
}
finally {
    $synth.SetOutputToNull()
    $synth.Dispose()
}

Write-Output "Done. Update durationMs in $manifestPath after regenerating."
