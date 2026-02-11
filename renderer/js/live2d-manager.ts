/**
 * Live2D 管理器
 * 负责加载、渲染和控制 Live2D 模型
 */

import type { 
  Live2DManager as ILive2DManager, 
  Live2DModel,
  ModelInfo,
  SyncCommandData,
  SyncAction,
  TapConfig
} from '../types/global';
import type { Application } from 'pixi.js';

// pixi-live2d-display 通过全局脚本加载（lib/pixi-live2d-cubism4.min.js）
// 运行时可通过 PIXI.live2d.Live2DModel 访问

// 确保 PIXI 全局可用（pixi-live2d-display 需要）
if (typeof window !== 'undefined') {
  (window as any).PIXI = window.PIXI;
}

// @ts-ignore - Live2DManager 被导出为全局实例
class Live2DManager implements ILive2DManager {
  public canvas: HTMLCanvasElement;
  public app: Application | null;
  public model: Live2DModel | null;
  public currentMotion: string | null;
  public currentExpression: string | null;
  public initialized: boolean;
  private isDragging: boolean = false;
  private dragStartX: number = 0;
  private dragStartY: number = 0;
  private modelStartX: number = 0;
  private modelStartY: number = 0;
  private originalModelBounds: { width: number; height: number } | null = null;
  private userScale: number = 1.0; // 用户自定义缩放倍数
  
  // 口型同步相关
  private lipSyncValue: number = 0;
  private lipSyncTarget: number = 0;
  private lipSyncEnabled: boolean = false;
  private baseScale: number = 1.0; // 自适应计算的基础缩放
  
  // 视线跟随相关
  private eyeTrackingEnabled: boolean = false;
  private mouseX: number = 0;
  private mouseY: number = 0;
  private eyeTrackingTimer: number | null = null;
  private isPlayingMotion: boolean = false;  // 标记是否正在播放动作

  constructor(canvasId: string) {
    const canvas = document.getElementById(canvasId) as HTMLCanvasElement;
    if (!canvas) {
      throw new Error(`Canvas element with id "${canvasId}" not found`);
    }
    this.canvas = canvas;
    this.app = null;
    this.model = null;
    this.currentMotion = null;
    this.currentExpression = null;
    this.initialized = false;
  }

  /**
   * 初始化 Live2D
   */
  public async initialize(): Promise<boolean> {
    try {
      // 创建 PixiJS 应用
      const PIXI = window.PIXI;
      
      // 使用 CSS 尺寸
      const width = this.canvas.clientWidth || window.innerWidth;
      const height = this.canvas.clientHeight || window.innerHeight;
      const dpr = window.devicePixelRatio || 1;
      
      this.app = new PIXI.Application({
        view: this.canvas,
        width: width,
        height: height,
        backgroundAlpha: 0,
        resolution: dpr,     // 使用设备像素比以获得清晰显示
        autoDensity: true    // 自动调整 CSS 尺寸
      });

      // 监听窗口大小变化
      this.setupResizeHandler();

      window.logger?.info('Live2D初始化成功', { width, height, dpr });
      this.initialized = true;
      return true;
    } catch (error) {
      window.logger?.error('Live2D初始化失败', { error });
      return false;
    }
  }

  /**
   * 加载 Live2D 模型
   * @param modelPath - 模型文件路径
   */
  public async loadModel(modelPath: string): Promise<boolean> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }

      window.logger?.info('Live2D开始加载模型', { modelPath });
      
      // 清除旧模型
      if (this.model && this.app) {
        this.app.stage.removeChild(this.model as any);
        (this.model as any).destroy?.();
      }
      
      // 使用 pixi-live2d-display 加载模型（通过全局 PIXI.live2d）
      const Live2DModel = (window.PIXI as any).live2d.Live2DModel;
      const MotionPreloadStrategy = (window.PIXI as any).live2d.MotionPreloadStrategy;
      const live2dModel = await Live2DModel.from(modelPath, {
        autoInteract: false,                          // 禁用自动交互，我们自己处理
        autoUpdate: true,                             // 启用自动更新
        motionPreload: MotionPreloadStrategy.IDLE     // 预加载 Idle 动画
      });
      
      this.model = live2dModel as any;
      
      // 初始化口型同步
      this.initLipSync();
      
      if (this.app) {
        // 添加到舞台
        this.app.stage.addChild(live2dModel as any);
        
        // 设置锚点为中心（pixi-live2d-display 支持）
        live2dModel.anchor.set(0.5, 0.5);
        
        // 保存模型原始尺寸（使用 internalModel 获取真正的原始尺寸）
        const internalModel = live2dModel.internalModel;
        if (internalModel) {
          this.originalModelBounds = {
            width: internalModel.width,
            height: internalModel.height
          };
        } else {
          // 回退方案
          this.originalModelBounds = {
            width: live2dModel.width,
            height: live2dModel.height
          };
        }
        
        window.logger?.debug('Live2D模型原始尺寸', this.originalModelBounds);
        
        // 调整模型位置和大小
        this.adjustModelTransform();
        
        // 设置拖动功能（同时处理点击）
        this.setupDragging(live2dModel);
        
        // 设置滚轮缩放功能
        this.setupWheelZoom();
      }
      
      // 提取并发送模型信息
      const modelInfo = this.extractModelInfo();
      if (modelInfo) {
        this.sendModelInfoToBackend(modelInfo);
      }
      
      window.logger?.info('Live2D模型加载成功', { modelPath });
      return true;
    } catch (error) {
      window.logger?.error('Live2D模型加载失败', { modelPath, error });
      throw error;
    }
  }

  /**
   * 设置窗口大小变化处理
   */
  private setupResizeHandler(): void {
    let resizeTimeout: number | null = null;
    
    window.addEventListener('resize', () => {
      // 防抖处理，避免频繁调整
      if (resizeTimeout) {
        window.clearTimeout(resizeTimeout);
      }
      
      resizeTimeout = window.setTimeout(() => {
        window.logger?.debug('Live2D窗口大小变化，调整模型位置');
        this.handleResize();
        resizeTimeout = null;
      }, 100);
    });
  }

  /**
   * 处理窗口大小变化
   */
  private handleResize(): void {
    if (!this.app || !this.model) return;

    // 强制获取最新的容器尺寸
    const container = this.canvas.parentElement;
    if (!container) return;
    
    const newWidth = container.clientWidth;
    const newHeight = container.clientHeight;

    window.logger?.debug('Live2D调整窗口尺寸', { width: newWidth, height: newHeight });

    // 更新canvas的CSS尺寸
    this.canvas.style.width = newWidth + 'px';
    this.canvas.style.height = newHeight + 'px';
    
    // 更新PixiJS渲染器尺寸
    this.app.renderer.resize(newWidth, newHeight);
    
    // 重新调整模型位置和大小
    this.adjustModelTransform();
  }

  /**
   * 设置模型拖动功能
   */
  private setupDragging(model: any): void {
    const dragThreshold = 3; // 拖动阈值
    let hasMoved = false;
    
    // 启用交互
    model.interactive = true;
    model.eventMode = 'static';
    this.canvas.style.cursor = 'grab';

    // 直接在整个 canvas 上处理拖动，不做碰撞检测
    this.canvas.addEventListener('mousedown', (event: MouseEvent) => {
      if (!this.model) return;
      
      this.isDragging = true;
      hasMoved = false;
      this.dragStartX = event.clientX;
      this.dragStartY = event.clientY;
      
      const m = this.model as any;
      this.modelStartX = m.x;
      this.modelStartY = m.y;
      this.canvas.style.cursor = 'grabbing';
      event.preventDefault();
    });

    // 全局监听 mousemove
    window.addEventListener('mousemove', (event: MouseEvent) => {
      if (!this.isDragging || !this.model) return;
      
      const deltaX = event.clientX - this.dragStartX;
      const deltaY = event.clientY - this.dragStartY;
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      
      if (distance > dragThreshold) {
        hasMoved = true;
        const m = this.model as any;
        m.x = this.modelStartX + deltaX;
        m.y = this.modelStartY + deltaY;
      }
    });

    // 全局监听 mouseup
    window.addEventListener('mouseup', () => {
      if (this.isDragging) {
        this.isDragging = false;
        this.canvas.style.cursor = 'grab';
        
        // 如果没有移动，触发点击事件
        if (!hasMoved && this.model) {
          window.logger?.debug('Live2D模型被点击');
          // 可以在这里触发点击事件
        }
      }
    });
  }

  /**
   * 调整模型位置和大小
   */
  public adjustModelTransform(): void {
    if (!this.model || !this.app) return;

    const model = this.model as any;
    
    // 获取容器的实际尺寸
    const container = this.canvas.parentElement;
    if (!container) return;
    
    const canvasWidth = container.clientWidth;
    const canvasHeight = container.clientHeight;
    
    // 确保渲染器尺寸与容器尺寸一致
    this.app.renderer.resize(canvasWidth, canvasHeight);
    
    // 使用原始模型尺寸或当前边界框
    let modelWidth: number;
    let modelHeight: number;
    
    if (this.originalModelBounds) {
      modelWidth = this.originalModelBounds.width;
      modelHeight = this.originalModelBounds.height;
    } else {
      // 回退方案：获取当前边界框并除以当前缩放比例
      const currentScale = model.scale.x || 1;
      modelWidth = model.width / currentScale;
      modelHeight = model.height / currentScale;
    }
    
    // 计算合适的基础缩放比例（保持75%的窗口占用，留出边距）
    const targetWidthRatio = 0.75;
    const targetHeightRatio = 0.75;
    
    const scaleX = (canvasWidth * targetWidthRatio) / modelWidth;
    const scaleY = (canvasHeight * targetHeightRatio) / modelHeight;
    this.baseScale = Math.min(scaleX, scaleY);
    
    // 应用基础缩放和用户自定义缩放
    const finalScale = this.baseScale * this.userScale;
    model.scale.set(finalScale);
    
    // 居中显示（X轴中心，Y轴居中）
    model.x = canvasWidth / 2;
    model.y = canvasHeight / 2;
    
    window.logger?.debug('Live2D模型位置调整', {
      originalSize: this.originalModelBounds,
      baseScale: this.baseScale,
      userScale: this.userScale,
      finalScale,
      position: { x: model.x, y: model.y },
      displaySize: { width: model.width, height: model.height },
      canvas: { width: canvasWidth, height: canvasHeight }
    });
  }

  /**
   * 设置滚轮缩放功能
   */
  private setupWheelZoom(): void {
    this.canvas.addEventListener('wheel', (event: WheelEvent) => {
      event.preventDefault();
      
      if (!this.model) return;
      
      // 计算缩放增量 (向上滚动放大，向下滚动缩小)
      const delta = -event.deltaY;
      const zoomSpeed = 0.001; // 缩放速度
      const zoomDelta = delta * zoomSpeed;
      
      // 更新用户缩放倍数，限制在 0.3 到 3.0 之间
      this.userScale = Math.max(0.3, Math.min(3.0, this.userScale + zoomDelta));
      
      // 应用新的缩放
      const model = this.model as any;
      const finalScale = this.baseScale * this.userScale;
      model.scale.set(finalScale);
      
      window.logger?.debug('Live2D滚轮缩放', {
        userScale: this.userScale.toFixed(2),
        finalScale: finalScale.toFixed(2)
      });
    }, { passive: false });
  }

  /**
   * 播放动作
   * @param motionGroup - 动作组
   * @param motionIndex - 动作索引
   * @param _priority - 优先级
   */
  public playMotion(motionGroup: string, motionIndex: number = 0, _priority: number = 2): void {
    if (!this.model) {
      window.logger?.warn('Live2D模型未加载，无法播放动作');
      return;
    }

    try {
      const model = this.model as any;
      
      // 使用 pixi-live2d-display 的动作播放
      if (model.internalModel && model.internalModel.motionManager) {
        // 设置动作标记
        this.isPlayingMotion = true;
        
        // 播放动作，并在完成后重置标记
        const motionPromise = model.motion(motionGroup, motionIndex);
        if (motionPromise && motionPromise.then) {
          motionPromise.then(() => {
            this.isPlayingMotion = false;
          }).catch((error: any) => {
            window.logger?.error('Live2D动作播放错误', { motionGroup, motionIndex, error });
            this.isPlayingMotion = false;
          });
        } else {
          // 如果没有返回Promise，使用定时器估算
          setTimeout(() => {
            this.isPlayingMotion = false;
          }, 2000); // 默认2秒后恢复
        }
        
        window.logger?.debug('Live2D播放动作', { motionGroup, motionIndex });
        this.currentMotion = `${motionGroup}[${motionIndex}]`;
      } else {
        window.logger?.warn('Live2D模型不支持动作播放');
      }
    } catch (error) {
      window.logger.error('播放动作失败:', error);
      this.isPlayingMotion = false;
    }
  }

  /**
   * 设置表情
   * @param expressionId - 表情ID
   */
  public setExpression(expressionId: string): void {
    if (!this.model) {
      window.logger?.warn('Live2D模型未加载，无法设置表情');
      return;
    }

    try {
      const model = this.model as any;
      
      // 使用 pixi-live2d-display 的表情设置
      if (model.internalModel && model.internalModel.motionManager) {
        model.expression(expressionId);
        window.logger?.debug('Live2D设置表情', { expressionId });
        this.currentExpression = expressionId;
      } else {
        window.logger?.warn('Live2D模型不支持表情设置');
      }
    } catch (error) {
      window.logger?.error('Live2D设置表情失败', { expressionId, error });
    }
  }

  /**
   * 视线跟随
   * @param x - Canvas 内的 X 像素坐标（世界空间）
   * @param y - Canvas 内的 Y 像素坐标（世界空间）
   */
  public lookAt(x: number, y: number): void {
    if (!this.model) return;

    try {
      const model = this.model as any;
      
      // pixi-live2d-display 的 focus() 方法接受世界空间的像素坐标
      // 库内部会自动：
      // 1. 通过 toModelPosition() 转换为模型内部坐标
      // 2. 归一化到 -1 ~ 1 范围
      // 3. 传递给 focusController 进行平滑插值
      if (typeof model.focus === 'function') {
        model.focus(x, y);
      }
    } catch (error) {
      // 忽略视线跟随错误
    }
  }

  /**
   * 点击模型时的反应
   * @param x - 点击 X 坐标
   * @param y - 点击 Y 坐标
   */
  public tap(x: number, y: number): void {
    if (!this.model) return;

    window.logger?.debug('Live2D点击模型', { x, y });
    
    const model = this.model as any;
    
    // 触发点击测试
    if (model.internalModel) {
      const hitAreaNames = model.internalModel.hitTest(x, y);
      if (hitAreaNames && hitAreaNames.length > 0) {
        const hitAreaName = hitAreaNames[0];
        window.logger?.debug('Live2D命中区域', { hitAreaName, x, y });
        
        // 检查该部位是否启用触摸反应
        if (this.isTapEnabled(hitAreaName)) {
          // 仅发送触碰事件到后端，由后端决定如何响应
          this.sendTapEventToBackend(hitAreaName, x, y);
        } else {
          window.logger?.debug('Live2D该部位触摸反应未启用', { hitAreaName });
        }
      } else {
        // 未命中任何区域
        if (this.isTapEnabled('default')) {
          this.sendTapEventToBackend('unknown', x, y);
        }
      }
    } else {
      // 如果没有命中测试，发送默认事件
      if (this.isTapEnabled('default')) {
        this.sendTapEventToBackend('unknown', x, y);
      }
    }
  }

  /**
   * 提取模型信息
   */
  public extractModelInfo(): ModelInfo | null {
    if (!this.model) return null;
    
    const model = this.model as any;
    const internalModel = model.internalModel;
    
    if (!internalModel) {
      return null;
    }

    // 提取动作组信息
    const motions: Record<string, { count: number; files: string[] }> = {};
    if (internalModel.motionManager?.definitions) {
      const definitions = internalModel.motionManager.definitions;
      for (const groupName in definitions) {
        if (definitions.hasOwnProperty(groupName)) {
          const group = definitions[groupName];
          motions[groupName] = {
            count: Array.isArray(group) ? group.length : 1,
            files: Array.isArray(group) ? group.map((m: any) => m.File || m.file) : [group.File || group.file]
          };
        }
      }
    }

    // 提取表情信息
    const expressions: string[] = [];
    if (internalModel.motionManager?.expressionManager?.definitions) {
      const expDefs = internalModel.motionManager.expressionManager.definitions;
      for (const expName in expDefs) {
        if (expDefs.hasOwnProperty(expName)) {
          expressions.push(expName);
        }
      }
    }

    // 提取命中区域信息
    const hitAreas: string[] = [];
    if (internalModel.hitAreas) {
      if (Array.isArray(internalModel.hitAreas)) {
        hitAreas.push(...internalModel.hitAreas.map((area: any) => area.name || area.Name || area.id || area.Id));
      } else if (typeof internalModel.hitAreas === 'object') {
        // hitAreas 可能是对象而非数组
        for (const key in internalModel.hitAreas) {
          if (internalModel.hitAreas.hasOwnProperty(key)) {
            hitAreas.push(key);
          }
        }
      }
    }

    return {
      available: true,
      modelPath: window.settingsManager?.getSettings().modelPath || 'unknown',
      dimensions: this.originalModelBounds || { width: 0, height: 0 },
      motions,
      expressions,
      hitAreas,
      availableParameters: this.getAvailableParameters(),
      parameters: {
        canScale: true,
        currentScale: this.userScale * this.baseScale,
        userScale: this.userScale,
        baseScale: this.baseScale
      }
    };
  }

  /**
   * 发送模型信息到后端
   */
  private sendModelInfoToBackend(modelInfo: ModelInfo): void {
    if (!modelInfo || !modelInfo.available) {
      window.logger?.warn('Live2D模型信息不可用，跳过发送');
      return;
    }

    window.logger?.info('Live2D发送模型信息到后端', { modelPath: modelInfo.modelPath });
    
    // 通过 backend-client 发送
    if (window.backendClient) {
      window.backendClient.sendMessage({
        type: 'model_info',
        data: modelInfo
      }).catch(err => {
        window.logger?.error('Live2D发送模型信息失败', { error: err });
      });
    }
  }

  /**
   * 检查触摸是否启用
   */
  public isTapEnabled(hitAreaName: string): boolean {
    const config = this.loadTapConfig();
    if (config[hitAreaName] !== undefined) {
      return config[hitAreaName].enabled === true;
    }
    // 默认启用
    return config['default']?.enabled !== false;
  }

  /**
   * 加载触碰配置
   */
  public loadTapConfig(): TapConfig {
    // 从设置管理器中读取当前模型的触碰配置
    if (window.settingsManager) {
      return window.settingsManager.getCurrentTapConfig();
    }
    
    // 默认配置（兜底）
    return {
      'Head': { enabled: true, description: '头部触摸' },
      'Body': { enabled: true, description: '身体触摸' },
      'Mouth': { enabled: true, description: '嘴部触摸' },
      'Face': { enabled: true, description: '脸部触摸' },
      'default': { enabled: true, description: '默认触摸' }
    };
  }

  /**
   * 发送触碰事件到后端
   */
  private sendTapEventToBackend(hitAreaName: string, x: number, y: number): void {
    if (!window.backendClient) return;

    window.backendClient.sendMessage({
      type: 'tap_event',
      data: {
        hitArea: hitAreaName,
        position: { x, y },
        timestamp: Date.now()
      }
    }).catch(err => {
      window.logger?.error('Live2D发送触碰事件失败', { hitAreaName, error: err });
    });
  }

  /**
   * 执行同步指令（支持文字、音频、动作、表情的组合）
   */
  public async executeSyncCommand(command: SyncCommandData): Promise<void> {
    window.logger?.info('Live2D执行同步指令', { actions: command.actions?.length });

    if (!command || !command.actions) {
      window.logger?.warn('Live2D同步指令格式错误');
      return;
    }

    // 按时序执行
    for (const action of command.actions) {
      await this.executeAction(action);
      
      // 如果需要等待完成
      if (action.waitComplete && action.duration) {
        await new Promise(resolve => setTimeout(resolve, action.duration));
      }
    }
  }

  /**
   * 执行单个动作
   */
  private async executeAction(action: SyncAction): Promise<void> {
    switch (action.type) {
      case 'motion':
        if (action.group) {
          this.playMotion(action.group, action.index || 0, action.priority || 2);
        }
        break;
      case 'expression':
        if (action.expressionId) {
          this.setExpression(action.expressionId);
        }
        break;
      case 'dialogue':
        if (window.dialogueManager && action.text) {
          window.dialogueManager.showDialogue(action.text, action.duration || 5000);
        }
        break;
      default:
        window.logger?.warn('Live2D未知动作类型', { type: action.type });
    }
  }

  /**
   * 启用/禁用视线跟随
   */
  public enableEyeTracking(enabled: boolean): void {
    this.eyeTrackingEnabled = enabled;
    
    if (enabled) {
      // 启动定时器持续获取鼠标位置
      if (!this.eyeTrackingTimer) {
        this.updateEyeTracking();
      }
    } else {
      // 停止定时器
      if (this.eyeTrackingTimer) {
        cancelAnimationFrame(this.eyeTrackingTimer);
        this.eyeTrackingTimer = null;
      }
      
      // 重置视线到正面中央位置
      if (this.model) {
        const model = this.model as any;
        // 直接操作 focusController 将视线重置为 (0, 0)
        // Live2DModel.focus() 方法会将坐标转换为方向向量，无法得到 (0, 0)
        // 因此需要直接调用 internalModel.focusController.focus(0, 0, true)
        const focusController = model.internalModel?.focusController;
        if (focusController && typeof focusController.focus === 'function') {
          focusController.focus(0, 0, true);
        }
      }
    }
  }
  
  /**
   * 更新视线跟随（使用requestAnimationFrame循环）
   */
  private async updateEyeTracking(): Promise<void> {
    if (!this.eyeTrackingEnabled) return;
    
    try {
      // 如果正在播放动作，跳过视线更新（动作优先）
      if (!this.isPlayingMotion) {
        // 获取鼠标在屏幕上的绝对坐标
        const cursorPos = await window.electronAPI.getCursorScreenPoint();
        
        // 获取窗口在屏幕上的位置
        const windowPos = await window.electronAPI.getWindowPosition();
        
        // 计算鼠标相对于窗口的位置（窗口坐标系）
        const rect = this.canvas.getBoundingClientRect();
        this.mouseX = cursorPos.x - windowPos.x - rect.left;
        this.mouseY = cursorPos.y - windowPos.y - rect.top;
        
        // 直接传递 Canvas 内的像素坐标给 lookAt
        // focus() 方法内部会自动处理坐标转换
        this.lookAt(this.mouseX, this.mouseY);
      }
    } catch (error) {
      window.logger?.error('Live2D更新视线跟随失败', { error });
    }
    
    // 继续下一帧
    if (this.eyeTrackingEnabled) {
      this.eyeTrackingTimer = requestAnimationFrame(() => this.updateEyeTracking());
    }
  }
  
  /**
   * 检查视线跟随是否启用
   */
  public isEyeTrackingEnabled(): boolean {
    return this.eyeTrackingEnabled;
  }

  /**
   * 设置模型参数
   * @param parameterId 参数ID（如 ParamEyeLOpen, ParamMouthOpenY）
   * @param value 参数值
   * @param weight 混合权重 (0-1)，用于平滑过渡
   */
  public setParameter(parameterId: string, value: number, weight: number = 1.0): void {
    if (!this.model) {
      window.logger.warn('[Live2D] 模型未加载，无法设置参数');
      return;
    }

    try {
      const model = this.model as any;
      const coreModel = model.internalModel?.coreModel;
      
      if (!coreModel) {
        window.logger.warn('[Live2D] 无法访问模型内部结构');
        return;
      }

      // 使用 addParameterValueById 带权重设置参数
      if (typeof coreModel.addParameterValueById === 'function') {
        coreModel.addParameterValueById(parameterId, value * weight);
      } else {
        window.logger.warn('[Live2D] 模型不支持 addParameterValueById 方法');
      }
    } catch (error) {
      window.logger.error('[Live2D] 设置参数失败:', error);
    }
  }

  /**
   * 批量设置模型参数
   * @param params 参数数组
   */
  public setParameters(params: Array<{id: string, value: number, blend?: number}>): void {
    if (!params || params.length === 0) return;
    
    params.forEach(param => {
      this.setParameter(param.id, param.value, param.blend !== undefined ? param.blend : 1.0);
    });
  }

  /**
   * 获取模型所有可用参数
   */
  public getAvailableParameters(): Array<{id: string, value: number, min: number, max: number, default: number}> {
    if (!this.model) return [];

    try {
      const model = this.model as any;
      const coreModel = model.internalModel?.coreModel;
      
      if (!coreModel) return [];

      const parameters: Array<{id: string, value: number, min: number, max: number, default: number}> = [];
      
      // Cubism 4 的 CubismModel 需要先获取底层的 model
      const nativeModel = coreModel.getModel ? coreModel.getModel() : coreModel;
      
      if (!nativeModel || !nativeModel.parameters) {
        window.logger?.warn('Live2D无法访问模型参数');
        return [];
      }

      // 从原生模型获取参数信息
      const paramCount = nativeModel.parameters.count;
      const paramIds = nativeModel.parameters.ids;
      const paramValues = nativeModel.parameters.values;
      const paramMinValues = nativeModel.parameters.minimumValues;
      const paramMaxValues = nativeModel.parameters.maximumValues;
      const paramDefaultValues = nativeModel.parameters.defaultValues;

      for (let i = 0; i < paramCount; i++) {
        try {
          parameters.push({
            id: paramIds[i],
            value: paramValues[i],
            min: paramMinValues[i],
            max: paramMaxValues[i],
            default: paramDefaultValues[i]
          });
        } catch (paramError) {
          // 忽略单个参数的错误
          window.logger?.warn('Live2D无法获取参数', { index: i, error: paramError });
        }
      }

      return parameters;
    } catch (error) {
      window.logger?.error('Live2D获取参数列表失败', { error });
      return [];
    }
  }

  /**
   * 销毁 Live2D
   */
  public destroy(): void {
    if (this.app) {
      this.app.destroy(true, { children: true });
      this.app = null;
    }
    this.model = null;
    this.lipSyncEnabled = false;
    this.initialized = false;
  }

  /**
   * 初始化口型同步
   */
  private initLipSync(): void {
    if (!this.model) return;
    
    // 启动口型同步更新循环
    this.lipSyncEnabled = true;
    this.updateLipSync();
  }

  /**
   * 更新口型同步（平滑插值）
   */
  private updateLipSync(): void {
    if (!this.lipSyncEnabled || !this.model) return;
    
    // 平滑插值到目标值
    const smoothing = 0.3;
    this.lipSyncValue += (this.lipSyncTarget - this.lipSyncValue) * smoothing;
    
    // 设置嘴部参数
    const internalModel = (this.model as any).internalModel;
    if (internalModel && internalModel.coreModel) {
      try {
        // Live2D 标准的嘴部张开参数
        internalModel.coreModel.setParameterValueById('ParamMouthOpenY', this.lipSyncValue);
      } catch (error) {
        // 忽略参数不存在的错误
      }
    }
    
    // 持续更新
    requestAnimationFrame(() => this.updateLipSync());
  }

  /**
   * 设置口型同步目标值（由音频播放器调用）
   * @param value 0-1 的值，表示嘴部张开程度
   */
  public setLipSync(value: number): void {
    this.lipSyncTarget = Math.max(0, Math.min(1, value));
  }

  /**
   * 停止口型同步
   */
  public stopLipSync(): void {
    this.lipSyncTarget = 0;
  }
}

// 导出全局实例
window.live2dManager = new Live2DManager('live2d-canvas');
