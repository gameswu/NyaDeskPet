/**
 * 多模态内容处理工具模块
 * 
 * 提供统一的多模态内容（图片、文件等）处理接口，供 Agent 插件使用。
 * 
 * 核心功能：
 * - MultimodalContent：统一的多模态内容描述格式
 * - 构建带多模态附件的 ChatMessage
 * - Provider 能力检测
 * - Data URL 转换
 * - 内容大小估算
 */

import { logger } from '../logger';
import type { ChatMessage, ChatMessageImage } from './provider';

// ==================== 核心类型 ====================

/** 多模态内容类型 */
export type MultimodalContentType = 'image' | 'file';

/** 统一的多模态内容描述 */
export interface MultimodalContent {
  /** 内容类型 */
  type: MultimodalContentType;
  /** Base64 编码的数据（与 url 二选一） */
  data?: string;
  /** URL 引用（与 data 二选一） */
  url?: string;
  /** MIME 类型（如 image/png, application/pdf） */
  mimeType?: string;
  /** 原始文件名 */
  fileName?: string;
}

/** Provider 能力信息 */
export interface ProviderCapabilities {
  /** 支持文本 */
  text: boolean;
  /** 支持图片输入（Vision） */
  vision: boolean;
  /** 支持文件输入 */
  file: boolean;
  /** 支持工具调用 */
  toolCalling: boolean;
}

// ==================== 工具函数 ====================

/**
 * 构建带多模态附件的 ChatMessage
 * 
 * @param role 消息角色
 * @param text 文本内容
 * @param content 多模态内容（可选）
 * @returns ChatMessage
 * 
 * @example
 * ```js
 * const msg = buildMultimodalMessage('user', '请描述这张图片', {
 *   type: 'image',
 *   data: base64Data,
 *   mimeType: 'image/png',
 *   fileName: 'screenshot.png'
 * });
 * ```
 */
export function buildMultimodalMessage(
  role: ChatMessage['role'],
  text: string,
  content?: MultimodalContent
): ChatMessage {
  const message: ChatMessage = { role, content: text };

  if (content) {
    message.attachment = {
      type: content.type,
      data: content.data,
      url: content.url,
      mimeType: content.mimeType,
      fileName: content.fileName
    };
  }

  return message;
}

/**
 * 将 MultimodalContent 转换为 data URL
 * 
 * @param content 多模态内容
 * @returns data URL 字符串，或 null（无 data 时返回 url 字段）
 */
export function toDataUrl(content: MultimodalContent): string | null {
  if (content.data) {
    const mimeType = content.mimeType || (content.type === 'image' ? 'image/png' : 'application/octet-stream');
    return `data:${mimeType};base64,${content.data}`;
  }
  return content.url || null;
}

/**
 * 从 data URL 解析出 MultimodalContent
 * 
 * @param dataUrl data URL 字符串
 * @param fileName 可选的文件名
 * @returns MultimodalContent，或 null（格式无效时）
 */
export function fromDataUrl(dataUrl: string, fileName?: string): MultimodalContent | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    // 尝试作为普通 URL 处理
    if (dataUrl.startsWith('http://') || dataUrl.startsWith('https://')) {
      const isImage = /\.(png|jpe?g|gif|webp|bmp|svg)(\?|$)/i.test(dataUrl);
      return {
        type: isImage ? 'image' : 'file',
        url: dataUrl,
        fileName
      };
    }
    return null;
  }

  const mimeType = match[1];
  const data = match[2];
  const isImage = mimeType.startsWith('image/');

  return {
    type: isImage ? 'image' : 'file',
    data,
    mimeType,
    fileName
  };
}

/**
 * 估算多模态内容的大小（字节）
 * 
 * @param content 多模态内容
 * @returns 估算字节数
 */
export function estimateContentSize(content: MultimodalContent): number {
  if (content.data) {
    // Base64 编码后大约是原始数据的 4/3
    return Math.ceil(content.data.length * 0.75);
  }
  return 0;
}

/**
 * 检查内容是否为图片类型
 */
export function isImageContent(content: MultimodalContent): boolean {
  if (content.type === 'image') return true;
  if (content.mimeType?.startsWith('image/')) return true;
  return false;
}

/**
 * 检查内容是否为文件类型
 */
export function isFileContent(content: MultimodalContent): boolean {
  return content.type === 'file' || !isImageContent(content);
}

/**
 * 将 ChatMessageImage（工具结果多模态）转换为 MultimodalContent
 */
export function fromChatMessageImage(image: ChatMessageImage): MultimodalContent {
  return {
    type: 'image',
    data: image.data,
    mimeType: image.mimeType
  };
}

/**
 * 将 MultimodalContent 转换为 ChatMessageImage（工具结果多模态）
 * 仅当 content 为图片类型且包含 data 时有效
 */
export function toChatMessageImage(content: MultimodalContent): ChatMessageImage | null {
  if (!isImageContent(content) || !content.data) return null;
  return {
    data: content.data,
    mimeType: content.mimeType || 'image/png'
  };
}

/**
 * 构建多个多模态内容的摘要描述
 * 
 * @param contents 多模态内容列表
 * @returns 文本描述
 */
export function describeContents(contents: MultimodalContent[]): string {
  if (contents.length === 0) return '';

  const parts: string[] = [];
  const images = contents.filter(isImageContent);
  const files = contents.filter(isFileContent);

  if (images.length > 0) {
    const names = images.map(c => c.fileName || '未命名图片').join(', ');
    parts.push(`${images.length} 张图片 (${names})`);
  }

  if (files.length > 0) {
    const names = files.map(c => c.fileName || '未命名文件').join(', ');
    parts.push(`${files.length} 个文件 (${names})`);
  }

  return parts.join('，');
}

/**
 * 检查 Provider 是否支持指定类型的多模态内容
 * 
 * @param capabilities Provider 能力声明
 * @param content 多模态内容
 * @returns 是否支持
 */
export function isContentSupported(capabilities: ProviderCapabilities, content: MultimodalContent): boolean {
  if (isImageContent(content)) {
    return capabilities.vision;
  }
  if (isFileContent(content)) {
    return capabilities.file;
  }
  return false;
}

/**
 * 验证多模态内容的合法性
 * 
 * @param content 要验证的内容
 * @returns 错误信息，null 表示合法
 */
export function validateContent(content: MultimodalContent): string | null {
  if (!content.type) {
    return '缺少类型 (type)';
  }
  if (content.type !== 'image' && content.type !== 'file') {
    return `不支持的类型: ${content.type}`;
  }
  if (!content.data && !content.url) {
    return '必须提供 data 或 url';
  }
  return null;
}

logger.info('[Multimodal] 多模态工具模块已加载');
