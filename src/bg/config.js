// src/bg/config.js — model IDs and endpoints. Change model IDs ONLY here.

export const MODELS = {
  brain: 'gpt-5.6-sol',           // low reasoning effort; max_output_tokens 150 voice / 400 text
  brainFallback: 'gpt-5.6-terra', // used for the single retry (row 9)
  side: 'gpt-5.6-luna',           // chips, sentiment tally (not called in the first build)
  stt: 'gpt-4o-mini-transcribe',
  tts: 'gpt-4o-mini-tts',
};

export const TTS_VOICE = 'coral';
export const REASONING_EFFORT = 'low';

export const API = {
  base: 'https://api.openai.com/v1',
  responses: 'https://api.openai.com/v1/responses',
  transcriptions: 'https://api.openai.com/v1/audio/transcriptions',
  speech: 'https://api.openai.com/v1/audio/speech',
};
