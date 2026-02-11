/**
 * Provider 模块统一导出
 * 所有 Provider 实现都在这里导入和注册
 * 
 * 注意：导入 Provider 文件时会自动触发 registerProvider() 注册
 */

// ==================== 内置 Provider ====================
export { EchoProvider, ECHO_METADATA } from './echo';

// ==================== OpenAI 兼容 Provider ====================
export { OpenAIProvider, OPENAI_METADATA } from './openai';

// ==================== 后续可添加更多 Provider ====================
// export { AnthropicProvider, ANTHROPIC_METADATA } from './anthropic';
// export { OllamaProvider, OLLAMA_METADATA } from './ollama';
// export { AzureOpenAIProvider, AZURE_OPENAI_METADATA } from './azure-openai';
