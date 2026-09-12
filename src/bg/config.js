// src/bg/config.js — model IDs live here and ONLY here. Change IDs in this file, nowhere else.

export const API_BASE = 'https://api.openai.com/v1';

export const MODELS = Object.freeze({
  brain: 'gpt-5.6-sol',          // low reasoning effort; max_output_tokens 150 voice / 400 text
  brainFallback: 'gpt-5.6-terra', // used for the single retry after a timeout / 5xx on `brain`
  side: 'gpt-5.6-luna',          // side tasks: chips, sentiment tally
  stt: 'gpt-4o-mini-transcribe',
  tts: 'gpt-4o-mini-tts',
  // NO image generation model. Attached images are vision INPUT only.
});

export const TTS_VOICE = 'coral';
export const REASONING_EFFORT = 'low';

export const ENDPOINTS = Object.freeze({
  responses: `${API_BASE}/responses`,
  transcriptions: `${API_BASE}/audio/transcriptions`,
  speech: `${API_BASE}/audio/speech`,
});
