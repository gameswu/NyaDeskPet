/**
 * Provider 模块统一导出
 * 所有 Provider 实现都在这里导入和注册
 * 
 * 注意：导入 Provider 文件时会自动触发 registerProvider() 注册
 */

// ==================== OpenAI 兼容 Provider ==
export { OpenAIProvider, OPENAI_METADATA } from './openai';

// ==================== DeepSeek Provider ====================
export { DeepSeekProvider, DEEPSEEK_METADATA } from './deepseek';

// ==================== OpenRouter Provider ====================
export { OpenRouterProvider, OPENROUTER_METADATA } from './openrouter';

// ==================== SiliconFlow Provider ====================
export { SiliconFlowProvider, SILICONFLOW_METADATA } from './siliconflow';

// ==================== Anthropic Provider ====================
export { AnthropicProvider, ANTHROPIC_METADATA } from './anthropic';

// ==================== Google Gemini Provider ====================
export { GeminiProvider, GEMINI_METADATA } from './gemini';

// ==================== DashScope Provider ====================
export { DashScopeProvider, DASHSCOPE_METADATA } from './dashscope';

// ==================== 智谱 AI Provider ====================
export { ZhipuProvider, ZHIPU_METADATA } from './zhipu';

// ==================== 火山引擎 Provider ====================
export { VolcengineProvider, VOLCENGINE_METADATA } from './volcengine';

// ==================== Groq Provider ====================
export { GroqProvider, GROQ_METADATA } from './groq';

// ==================== Mistral AI Provider ====================
export { MistralProvider, MISTRAL_METADATA } from './mistral';

// ==================== xAI Provider ====================
export { XAIProvider, XAI_METADATA } from './xai';
// export { AnthropicProvider, ANTHROPIC_METADATA } from './anthropic';
// export { OllamaProvider, OLLAMA_METADATA } from './ollama';
// export { AzureOpenAIProvider, AZURE_OPENAI_METADATA } from './azure-openai';
