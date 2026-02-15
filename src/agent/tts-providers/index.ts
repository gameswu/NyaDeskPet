/**
 * TTS Provider 模块统一导出
 * 所有 TTS Provider 实现都在这里导入和注册
 * 
 * 注意：导入 Provider 文件时会自动触发 registerTTSProvider() 注册
 */

// ==================== Fish Audio TTS Provider ====================
export { FishAudioProvider, FISH_AUDIO_METADATA } from './fish-audio';

// ==================== Edge TTS Provider ====================
export { EdgeTTSProvider, EDGE_TTS_METADATA } from './edge-tts';

// ==================== OpenAI TTS Provider ====================
export { OpenAITTSProvider, OPENAI_TTS_METADATA } from './openai-tts';

// ==================== ElevenLabs TTS Provider ====================
export { ElevenLabsProvider, ELEVENLABS_METADATA } from './elevenlabs';
