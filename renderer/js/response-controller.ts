/**
 * 响应控制器
 * 管理前端响应的优先级与中断逻辑
 * 
 * 核心职责：
 * 1. 跟踪当前正在播放/展示的响应会话（responseId + priority）
 * 2. 当新的响应到达时，根据优先级判断是否中断当前响应
 * 3. 中断时负责停止音频、清除对话、取消时间轴等清理工作
 * 4. 丢弃低优先级响应中后续到达的音频分片等消息
 * 
 * 优先级约定（由后端分配）：
 *   10 — 用户主动输入触发的回复（user_input）
 *    8 — 触碰反应（tap_event）
 *    5 — 插件/系统主动推送
 *    3 — 低优先级通知
 *    0 — 默认（无优先级标记的旧消息）
 * 
 * 中断规则：新响应优先级 >= 当前响应优先级 → 中断当前，执行新响应
 *           新响应优先级 <  当前响应优先级 → 丢弃新响应
 */

export interface ResponseSession {
  /** 响应唯一 ID（后端分配） */
  responseId: string;
  /** 优先级 */
  priority: number;
  /** 开始时间 */
  startTime: number;
  /** 是否包含正在进行的音频流 */
  hasActiveAudio: boolean;
}

class ResponseController {
  /** 当前活跃的响应会话 */
  private currentSession: ResponseSession | null = null;

  /** 被丢弃的 responseId 集合（用于过滤后续分片） */
  private discardedIds: Set<string> = new Set();

  /** 最大缓存的 discardedIds 数量，防止内存泄漏 */
  private static MAX_DISCARDED_CACHE = 50;

  /**
   * 判断是否应该接受新的响应，并在需要时中断当前响应
   * 
   * @param responseId  新响应的 ID
   * @param priority    新响应的优先级
   * @returns true = 接受新响应, false = 丢弃新响应
   */
  public shouldAccept(responseId: string, priority: number): boolean {
    // 同一个 responseId 的后续消息总是接受
    if (this.currentSession && this.currentSession.responseId === responseId) {
      return true;
    }

    // 检查是否已被丢弃
    if (this.discardedIds.has(responseId)) {
      return false;
    }

    // 没有当前会话，直接接受
    if (!this.currentSession) {
      this.beginSession(responseId, priority);
      return true;
    }

    // 优先级比较：>= 当前优先级才能中断
    if (priority >= this.currentSession.priority) {
      window.logger?.info(
        `[ResponseController] 中断响应 ${this.currentSession.responseId} (priority=${this.currentSession.priority}) → 新响应 ${responseId} (priority=${priority})`
      );
      this.interruptCurrent();
      this.beginSession(responseId, priority);
      return true;
    }

    // 优先级不够，丢弃新响应
    window.logger?.info(
      `[ResponseController] 丢弃低优先级响应 ${responseId} (priority=${priority}), 当前 ${this.currentSession.responseId} (priority=${this.currentSession.priority})`
    );
    this.addDiscarded(responseId);
    return false;
  }

  /**
   * 检查指定 responseId 的消息是否应该被处理
   * 用于音频分片等后续消息的快速过滤
   */
  public isActive(responseId: string | undefined): boolean {
    // 没有 responseId 的消息（旧协议兼容）总是接受
    if (!responseId) return true;

    // 已被丢弃
    if (this.discardedIds.has(responseId)) return false;

    // 属于当前会话
    if (this.currentSession && this.currentSession.responseId === responseId) return true;

    // 没有当前会话，接受
    if (!this.currentSession) return true;

    return false;
  }

  /**
   * 标记当前会话有活跃的音频流
   */
  public markAudioActive(): void {
    if (this.currentSession) {
      this.currentSession.hasActiveAudio = true;
    }
  }

  /**
   * 通知当前响应已自然结束（音频播放完毕、对话消失等）
   */
  public notifyComplete(responseId?: string): void {
    if (!this.currentSession) return;
    if (responseId && this.currentSession.responseId !== responseId) return;
    
    window.logger?.info(`[ResponseController] 响应 ${this.currentSession.responseId} 自然结束`);
    this.currentSession = null;
  }

  /**
   * 获取当前会话信息
   */
  public getCurrentSession(): ResponseSession | null {
    return this.currentSession;
  }

  /**
   * 中断当前正在进行的响应
   */
  private interruptCurrent(): void {
    if (!this.currentSession) return;

    const session = this.currentSession;

    // 1. 停止音频播放
    if (window.audioPlayer) {
      window.audioPlayer.stop();
    }

    // 2. 清除对话显示
    if (window.dialogueManager) {
      window.dialogueManager.hideDialogue();
    }

    // 将被中断的会话 ID 加入丢弃列表（后续分片会被过滤）
    this.addDiscarded(session.responseId);
    this.currentSession = null;
  }

  /**
   * 开始一个新的响应会话
   */
  private beginSession(responseId: string, priority: number): void {
    this.currentSession = {
      responseId,
      priority,
      startTime: Date.now(),
      hasActiveAudio: false
    };
  }

  /**
   * 添加到丢弃列表
   */
  private addDiscarded(responseId: string): void {
    this.discardedIds.add(responseId);
    
    // 限制缓存大小
    if (this.discardedIds.size > ResponseController.MAX_DISCARDED_CACHE) {
      const iter = this.discardedIds.values();
      this.discardedIds.delete(iter.next().value as string);
    }
  }
}

// 导出全局实例
window.responseController = new ResponseController();
