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
  TapConfig,
  ParamMapConfig
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
  private lipSyncParams: string[] = [];
  private baseScale: number = 1.0; // 自适应计算的基础缩放
  
  // 参数覆盖系统（通过 beforeModelUpdate 事件每帧持久写入）
  // SDK 每帧流程：Motion(覆写参数) → saveParameters(快照) → Expression → Physics → beforeModelUpdate → render → loadParameters(恢复快照)
  // 因此直接调用 setParameterValueById 只在当前帧生效，下一帧被快照恢复。
  // 通过在 beforeModelUpdate 事件中每帧写入，保证参数覆盖持久生效直到过渡完成。
  //
  // 参数生命周期：
  // 1. 过渡期：easeInOutCubic 从 startValue 到 targetValue（duration ms）
  // 2. 保持期：维持 targetValue 不变（HOLD_AFTER_TRANSITION_MS）
  // 3. 淡出释放期：权重从 1.0 渐变到 0，平滑交还 SDK 控制（RELEASE_DURATION_MS）
  private parameterOverrides: Map<string, {
    targetValue: number;
    startValue: number;
    weight: number;
    startTime: number;
    duration: number;      // 过渡动画时长（ms）
    holdUntil: number;     // 保持到此时间戳后开始淡出
    releaseEnd: number;    // 淡出释放结束时间戳，到此时从 Map 移除
  }> = new Map();
  private modelUpdateCleanup: (() => void) | null = null;
  
  // 视线跟随相关
  private eyeTrackingEnabled: boolean = false;
  private mouseX: number = 0;
  private mouseY: number = 0;
  private eyeTrackingTimer: number | null = null;
  private isPlayingMotion: boolean = false;  // 标记是否正在播放动作
  private isAnimatingParams: boolean = false;  // 标记是否正在执行参数动画（优先于视线跟随）

  // 参数映射表（从模型目录的 param-map.json 加载）
  private paramMapConfig: ParamMapConfig | null = null;

  /** 参数映射表文件名 */
  private static readonly PARAM_MAP_FILENAME = 'param-map.json';

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
   * 销毁当前模型并释放所有相关资源
   */
  private async destroyCurrentModel(): Promise<void> {
    if (!this.model) return;

    window.logger?.info('Live2D开始释放模型资源');

    try {
      // 停止所有动画和音频
      this.stopLipSync();
      if (this.eyeTrackingTimer) {
        cancelAnimationFrame(this.eyeTrackingTimer);
        this.eyeTrackingTimer = null;
      }
      
      // 清理参数覆盖系统
      if (this.modelUpdateCleanup) {
        this.modelUpdateCleanup();
        this.modelUpdateCleanup = null;
      }
      this.parameterOverrides.clear();

      // 从舞台移除
      if (this.app && this.model) {
        this.app.stage.removeChild(this.model as any);
      }

      // 获取内部模型引用
      const internalModel = (this.model as any).internalModel;
      
      // 销毁所有纹理
      if (internalModel && internalModel.textures) {
        for (const texture of internalModel.textures) {
          if (texture && typeof texture.destroy === 'function') {
            texture.destroy(true); // true 表示同时销毁 BaseTexture
          }
        }
        window.logger?.debug('Live2D已销毁纹理资源');
      }

      // 销毁模型本身
      if (typeof (this.model as any).destroy === 'function') {
        (this.model as any).destroy({
          children: true,    // 销毁所有子元素
          texture: true,     // 销毁纹理
          baseTexture: true  // 销毁基础纹理
        });
      }

      // 清空引用
      this.model = null;
      this.currentMotion = null;
      this.currentExpression = null;
      this.originalModelBounds = null;
      this.lipSyncEnabled = false;
      this.isPlayingMotion = false;
      this.paramMapConfig = null;

      window.logger?.info('Live2D模型资源释放完成');

      // 建议垃圾回收（仅在开发环境）
      if (typeof (window as any).gc === 'function') {
        (window as any).gc();
        window.logger?.debug('Live2D已触发垃圾回收');
      }
    } catch (error) {
      window.logger?.error('Live2D释放模型资源失败', { error });
    }
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
      
      // GPU 优化配置
      this.app = new PIXI.Application({
        view: this.canvas,
        width: width,
        height: height,
        backgroundAlpha: 0,
        resolution: dpr,     // 使用设备像素比以获得清晰显示
        autoDensity: true,   // 自动调整 CSS 尺寸
        // GPU 性能优化
        antialias: true,     // 抗锯齿
        powerPreference: 'high-performance',  // 优先使用独立显卡
        // WebGL 上下文优化
        preserveDrawingBuffer: false,  // 不保留绘图缓冲区（提高性能）
        clearBeforeRender: true,       // 每帧清除画布（避免残影）
        // 限制帧率以降低 GPU 负载（Live2D 不需要太高帧率）
        sharedTicker: true
      });
      
      // 为 Windows 降低目标帧率以减少 GPU 压力
      if (navigator.userAgent.includes('Windows')) {
        const ticker = (this.app as any).ticker;
        if (ticker) {
          ticker.maxFPS = 60;  // 限制为 60 FPS
          window.logger?.info('Live2D已设置帧率限制', { maxFPS: 60 });
        }
      }

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
      
      // 清除旧模型和释放资源
      await this.destroyCurrentModel();
      
      // 使用 pixi-live2d-display 加载模型（通过全局 PIXI.live2d）
      const Live2DModel = (window.PIXI as any).live2d.Live2DModel;
      const MotionPreloadStrategy = (window.PIXI as any).live2d.MotionPreloadStrategy;
      const live2dModel = await Live2DModel.from(modelPath, {
        autoInteract: false,                          // 禁用自动交互，我们自己处理
        autoUpdate: true,                             // 启用自动更新
        motionPreload: MotionPreloadStrategy.IDLE     // 预加载 Idle 动画
      });
      
      this.model = live2dModel as any;
      
      // 修复 SDK hitAreas 空 Name 碰撞问题
      // SDK 的 setupHitAreas() 以 model3.json 的 Name 为 key 存入对象
      // 当多个 HitArea 的 Name 都为空字符串时只保留最后一个
      // 这里使用 getHitAreaDefs() 获取完整列表，以 Id（或 Name）为 key 重建
      this.patchHitAreas(live2dModel);
      
      // 检测模型的 LipSync 参数组
      this.detectLipSyncParams(live2dModel);
      
      // 挂载 beforeModelUpdate 事件钩子：每帧渲染前写入参数覆盖 + 口型同步
      this.setupParameterOverrideHook(live2dModel);
      
      // 标记口型同步已启用（实际写入由 beforeModelUpdate 钩子驱动）
      this.lipSyncEnabled = true;
      
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
      
      // 加载参数映射表（在提取模型信息之前，确保 mappedParameters 能被包含）
      await this.loadParamMap(modelPath);
      
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
      
      // 将别名映射回 SDK 实际的组名（部分模型的动作组名为空字符串）
      const FALLBACK_MOTION_GROUP = 'Default';
      const actualGroup = motionGroup === FALLBACK_MOTION_GROUP ? '' : motionGroup;
      
      // 使用 pixi-live2d-display 的动作播放
      if (model.internalModel && model.internalModel.motionManager) {
        // 设置动作标记
        this.isPlayingMotion = true;
        
        // 播放动作，并在完成后重置标记
        const motionPromise = model.motion(actualGroup, motionIndex);
        if (motionPromise && motionPromise.then) {
          motionPromise.then(() => {
            this.isPlayingMotion = false;
          }).catch((error: any) => {
            window.logger?.error('Live2D动作播放错误', { motionGroup: actualGroup, motionIndex, error });
            this.isPlayingMotion = false;
          });
        } else {
          // 如果没有返回Promise，使用定时器估算
          const MOTION_FALLBACK_DURATION = 2000;
          setTimeout(() => {
            this.isPlayingMotion = false;
          }, MOTION_FALLBACK_DURATION);
        }
        
        window.logger?.debug('Live2D播放动作', { motionGroup: actualGroup, motionIndex });
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
   * 加载参数映射表（param-map.json）
   * 从模型目录读取用户提供的参数/表情/动作别名映射，用于构建对 LLM 友好的模型信息
   */
  private async loadParamMap(modelPath: string): Promise<void> {
    try {
      const lastSlash = modelPath.lastIndexOf('/');
      const modelDir = lastSlash >= 0 ? modelPath.substring(0, lastSlash) : '.';
      const url = `${modelDir}/${Live2DManager.PARAM_MAP_FILENAME}`;

      const response = await fetch(url);
      if (!response.ok) {
        this.paramMapConfig = null;
        window.logger?.debug('[Live2D] 模型目录未提供参数映射表', { path: url });
        return;
      }

      const config = await response.json() as ParamMapConfig;
      if (!config || typeof config !== 'object' || config.version !== 1) {
        this.paramMapConfig = null;
        window.logger?.warn('[Live2D] 参数映射表版本不支持，期望 version: 1');
        return;
      }

      this.paramMapConfig = config;
      window.logger?.info('[Live2D] 参数映射表已加载', {
        params: config.parameters?.length ?? 0,
        expressions: config.expressions?.length ?? 0,
        motions: config.motions?.length ?? 0
      });
    } catch {
      this.paramMapConfig = null;
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
    // 部分模型的动作组名为空字符串，替换为可读的别名让 LLM 可以引用
    const FALLBACK_MOTION_GROUP = 'Default';
    const motions: Record<string, { count: number; files: string[] }> = {};
    if (internalModel.motionManager?.definitions) {
      const definitions = internalModel.motionManager.definitions;
      for (const groupName in definitions) {
        if (definitions.hasOwnProperty(groupName)) {
          const group = definitions[groupName];
          const displayName = groupName || FALLBACK_MOTION_GROUP;
          motions[displayName] = {
            count: Array.isArray(group) ? group.length : 1,
            files: Array.isArray(group) ? group.map((m: any) => m.File || m.file) : [group.File || group.file]
          };
        }
      }
    }

    // 提取表情信息
    // expressionManager.definitions 是数组（来自 model3.json Expressions[]），
    // 每个元素包含 { Name, File }，需要提取 Name 字段
    const expressions: string[] = [];
    if (internalModel.motionManager?.expressionManager?.definitions) {
      const expDefs = internalModel.motionManager.expressionManager.definitions;
      if (Array.isArray(expDefs)) {
        for (const def of expDefs) {
          if (def && def.Name) {
            expressions.push(def.Name);
          }
        }
      }
    }

    // 提取命中区域信息
    // 使用 getHitAreaDefs() 获取完整列表（不受 SDK hitAreas 空 Name 碰撞影响）
    // 优先使用 Name 作为显示名，Name 为空时 fallback 到 Id
    const hitAreas: string[] = [];
    if (typeof internalModel.getHitAreaDefs === 'function') {
      const defs: Array<{ id: string; name: string; index: number }> = internalModel.getHitAreaDefs();
      for (const def of defs) {
        const effectiveName = def.name || def.id || '';
        if (effectiveName && def.index >= 0) hitAreas.push(effectiveName);
      }
    } else if (internalModel.hitAreas && typeof internalModel.hitAreas === 'object') {
      // 兜底：直接读取已修补的 hitAreas 对象
      for (const key of Object.keys(internalModel.hitAreas)) {
        if (key) hitAreas.push(key);
      }
    }

    // 构建基础模型信息
    const allParams = this.getAvailableParameters();
    const modelInfo: ModelInfo = {
      available: true,
      modelPath: window.settingsManager?.getSettings().modelPath || 'unknown',
      dimensions: this.originalModelBounds || { width: 0, height: 0 },
      motions,
      expressions,
      hitAreas,
      availableParameters: allParams,
      parameters: {
        canScale: true,
        currentScale: this.userScale * this.baseScale,
        userScale: this.userScale,
        baseScale: this.baseScale
      }
    };

    // 如果存在参数映射表，构建 LLM 友好的映射字段
    if (this.paramMapConfig) {
      this._enrichModelInfoWithParamMap(modelInfo, allParams, expressions, motions);
    }

    return modelInfo;
  }

  /**
   * 用参数映射表丰富模型信息，将遴选的参数/表情/动作附加语义别名和描述
   * 前端只提供别名和描述，实际数值范围由模型参数自动填入
   */
  private _enrichModelInfoWithParamMap(
    modelInfo: ModelInfo,
    allParams: Array<{id: string; value: number; min: number; max: number; default: number}>,
    expressions: string[],
    motions: Record<string, { count: number; files: string[] }>
  ): void {
    const config = this.paramMapConfig!;

    // 参数映射：查找真实参数范围并合并
    if (config.parameters && config.parameters.length > 0) {
      const paramLookup = new Map(allParams.map(p => [p.id, p]));
      const mapped: ModelInfo['mappedParameters'] = [];
      for (const entry of config.parameters) {
        const real = paramLookup.get(entry.id);
        if (real) {
          mapped.push({
            id: entry.id,
            alias: entry.alias,
            description: entry.description,
            min: real.min,
            max: real.max,
            default: real.default
          });
        } else {
          window.logger?.warn('[Live2D] 参数映射表引用了不存在的参数', { id: entry.id });
        }
      }
      if (mapped.length > 0) {
        modelInfo.mappedParameters = mapped;
      }
    }

    // 表情映射
    if (config.expressions && config.expressions.length > 0) {
      const validExps = new Set(expressions);
      const mapped: ModelInfo['mappedExpressions'] = [];
      for (const entry of config.expressions) {
        if (validExps.has(entry.id)) {
          mapped.push({ id: entry.id, alias: entry.alias, description: entry.description });
        } else {
          window.logger?.warn('[Live2D] 参数映射表引用了不存在的表情', { id: entry.id });
        }
      }
      if (mapped.length > 0) {
        modelInfo.mappedExpressions = mapped;
      }
    }

    // 动作映射（逐个动作级别：group + index）
    if (config.motions && config.motions.length > 0) {
      const mapped: ModelInfo['mappedMotions'] = [];
      for (const entry of config.motions) {
        const motionGroup = motions[entry.group];
        if (!motionGroup) {
          window.logger?.warn('[Live2D] 参数映射表引用了不存在的动作组', { group: entry.group });
          continue;
        }
        if (entry.index < 0 || entry.index >= motionGroup.count) {
          window.logger?.warn('[Live2D] 参数映射表引用了不存在的动作索引', { group: entry.group, index: entry.index, count: motionGroup.count });
          continue;
        }
        mapped.push({
          group: entry.group,
          index: entry.index,
          alias: entry.alias,
          description: entry.description
        });
      }
      if (mapped.length > 0) {
        modelInfo.mappedMotions = mapped;
      }
    }
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
        if (action.group !== undefined) {
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
      case 'parameter':
        if (action.parameters && action.parameters.length > 0) {
          // 数组格式（来自 SyncAction 标准格式）
          this.setParameters(action.parameters);
        } else if (action.parameterId !== undefined && action.value !== undefined) {
          // 扁平格式（来自 protocol-adapter 的 _actionToSyncAction）
          this.setParameter(
            action.parameterId, 
            action.value, 
            action.weight ?? 1.0, 
            action.duration ?? 0  // 0 = 自动计算过渡时长
          );
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
      // 如果正在播放动作或参数动画，跳过视线更新（模型控制优先）
      if (!this.isPlayingMotion && !this.isAnimatingParams) {
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

  /** 过渡完成后保持目标值的时长（ms），然后开始淡出释放 */
  private static readonly HOLD_AFTER_TRANSITION_MS = 2000;

  /** 从保持状态淡出到完全释放的时长（ms），权重从 1.0 渐变到 0 */
  private static readonly RELEASE_DURATION_MS = 500;

  /** 自动计算过渡时长的范围（ms） */
  private static readonly MIN_AUTO_DURATION_MS = 200;
  private static readonly MAX_AUTO_DURATION_MS = 900;
  /** 无法获取参数范围时的回退过渡时长（ms） */
  private static readonly FALLBACK_AUTO_DURATION_MS = 400;

  /**
   * 设置模型参数（带缓动过渡动画 + 自动时长计算）
   * 
   * 将参数加入覆盖映射，由 beforeModelUpdate 事件每帧计算缓动值并写入。
   * 参数完整生命周期：过渡 → 保持 → 淡出释放。
   * 
   * SDK 每帧末尾 loadParameters() 会恢复快照、擦除外部写入，
   * 因此不能直接调用 coreModel API，必须通过事件钩子持久注入。
   * 
   * @param parameterId 参数ID（如 ParamAngleX, ParamEyeLOpen）
   * @param value 目标值（必须在参数 min~max 范围内）
   * @param weight 混合权重 (0-1)
   * @param duration 过渡动画时长（ms）。0 或不传 = 根据参数变化幅度自动计算
   */
  public setParameter(parameterId: string, value: number, weight: number = 1.0, duration: number = 0): void {
    if (!this.model) {
      window.logger.warn('[Live2D] 模型未加载，无法设置参数');
      return;
    }

    // 有参数动画在进行，抑制视线跟随（Map 清空时自动恢复）
    this.isAnimatingParams = true;

    // 获取当前值作为起始值（如果已在覆盖中，使用当前插值位置）
    const existing = this.parameterOverrides.get(parameterId);
    let startValue: number;
    if (existing) {
      // 计算当前覆盖的插值位置作为新动画的起始值
      startValue = this._calculateCurrentOverrideValue(existing);
    } else {
      // 尝试从模型获取当前参数值
      startValue = this._getModelParameterValue(parameterId) ?? value;
    }

    // 自动计算过渡时长：根据参数值变化幅度 / 参数总范围 线性映射
    let transitionDuration: number;
    if (duration > 0) {
      transitionDuration = duration;
    } else {
      transitionDuration = this._computeTransitionDuration(parameterId, startValue, value);
    }

    const now = Date.now();

    // 添加到覆盖映射，由 beforeModelUpdate 钩子每帧计算缓动
    this.parameterOverrides.set(parameterId, {
      targetValue: value,
      startValue,
      weight,
      startTime: now,
      duration: transitionDuration,
      holdUntil: now + transitionDuration + Live2DManager.HOLD_AFTER_TRANSITION_MS,
      releaseEnd: now + transitionDuration + Live2DManager.HOLD_AFTER_TRANSITION_MS + Live2DManager.RELEASE_DURATION_MS
    });

    window.logger?.debug('[Live2D] 参数缓动已设置', { parameterId, startValue, targetValue: value, weight, duration: transitionDuration });
  }

  /**
   * 批量设置模型参数（带缓动过渡动画）
   * @param params 参数数组
   */
  public setParameters(params: Array<{id: string, value: number, blend?: number, duration?: number}>): void {
    if (!params || params.length === 0) return;
    
    params.forEach(param => {
      this.setParameter(
        param.id, 
        param.value, 
        param.blend !== undefined ? param.blend : 1.0,
        param.duration !== undefined ? param.duration : 0
      );
    });
  }

  /**
   * 清除所有参数覆盖
   */
  public clearParameterOverrides(): void {
    this.parameterOverrides.clear();
    this.isAnimatingParams = false;
  }

  /**
   * 在 SDK 的 beforeModelUpdate 事件中注入参数覆盖和口型同步
   * 
   * 此事件在每帧所有 SDK 内部处理（动作、表情、物理等）之后、
   * coreModel.update()（渲染）之前触发。
   * 在此写入的参数值会直接用于当前帧渲染，不会被 SDK 覆盖。
   */
  private setupParameterOverrideHook(live2dModel: any): void {
    // 清理旧 hook
    if (this.modelUpdateCleanup) {
      this.modelUpdateCleanup();
      this.modelUpdateCleanup = null;
    }

    const internalModel = live2dModel.internalModel;
    if (!internalModel) return;

    const handler = () => {
      this.applyParameterOverrides(internalModel);
      this.applyLipSync(internalModel);
    };

    internalModel.on('beforeModelUpdate', handler);
    this.modelUpdateCleanup = () => {
      internalModel.off('beforeModelUpdate', handler);
    };

    window.logger?.info('[Live2D] 参数覆盖钩子已挂载（beforeModelUpdate）');
  }

  /**
   * 每帧调用：应用所有活跃的参数覆盖（带缓动插值 + 淡出释放），清理过期条目
   * 
   * 参数生命周期三阶段：
   * 1. 过渡期：easeInOutCubic 从 startValue → targetValue，weight 不变
   * 2. 保持期：维持 targetValue，weight 不变
   * 3. 淡出释放期：维持 targetValue，weight 从原始值渐变到 0（平滑交还 SDK 控制）
   */
  private applyParameterOverrides(internalModel: any): void {
    if (this.parameterOverrides.size === 0) return;

    const coreModel = internalModel?.coreModel;
    if (!coreModel) return;

    const now = Date.now();
    const expired: string[] = [];

    for (const [paramId, override] of this.parameterOverrides) {
      // 淡出释放已结束，标记移除
      if (now >= override.releaseEnd) {
        expired.push(paramId);
        continue;
      }

      try {
        // 计算缓动插值和有效权重
        const { value, weight } = this._calculateOverrideState(override);
        // 权重极小时跳过写入（避免浮点噪声）
        if (weight > 0.001) {
          coreModel.setParameterValueById(paramId, value, weight);
        }
      } catch {
        // 参数不存在，移除
        expired.push(paramId);
      }
    }

    // 清理过期条目
    for (const paramId of expired) {
      this.parameterOverrides.delete(paramId);
    }

    // 所有覆盖过期后恢复视线跟随
    if (this.parameterOverrides.size === 0 && this.isAnimatingParams) {
      this.isAnimatingParams = false;
    }
  }

  /**
   * 计算参数覆盖的当前状态（值 + 有效权重）
   * 
   * 三阶段模型：
   * - 过渡期：easeInOutCubic 插值，权重不变
   * - 保持期：目标值，权重不变
   * - 淡出释放期：目标值，权重渐变到 0
   */
  private _calculateOverrideState(override: {
    targetValue: number;
    startValue: number;
    weight: number;
    startTime: number;
    duration: number;
    holdUntil: number;
    releaseEnd: number;
  }): { value: number; weight: number } {
    const now = Date.now();
    const elapsed = now - override.startTime;

    // 阶段 1: 过渡期 — easeInOutCubic 插值
    if (override.duration > 0 && elapsed < override.duration) {
      const t = elapsed / override.duration;
      const eased = Live2DManager._easeInOutCubic(t);
      const value = override.startValue + (override.targetValue - override.startValue) * eased;
      return { value, weight: override.weight };
    }

    // 阶段 2: 保持期 — 维持目标值
    if (now < override.holdUntil) {
      return { value: override.targetValue, weight: override.weight };
    }

    // 阶段 3: 淡出释放期 — 权重渐变到 0
    const releaseDuration = override.releaseEnd - override.holdUntil;
    if (releaseDuration > 0 && now < override.releaseEnd) {
      const releaseProgress = (now - override.holdUntil) / releaseDuration;
      const eased = Live2DManager._easeInOutCubic(releaseProgress);
      const fadedWeight = override.weight * (1 - eased);
      return { value: override.targetValue, weight: fadedWeight };
    }

    // 已过期
    return { value: override.targetValue, weight: 0 };
  }

  /**
   * 计算当前覆盖参数的视觉位置值（用于动画衔接时的起始值捕获）
   * 过渡期返回插值位置，保持期和释放期返回目标值
   */
  private _calculateCurrentOverrideValue(override: {
    targetValue: number;
    startValue: number;
    startTime: number;
    duration: number;
    holdUntil: number;
    releaseEnd: number;
  }): number {
    const now = Date.now();
    const elapsed = now - override.startTime;

    // 过渡期：返回当前插值位置
    if (override.duration > 0 && elapsed < override.duration) {
      const t = elapsed / override.duration; // 0 → 1
      const eased = Live2DManager._easeInOutCubic(t);
      return override.startValue + (override.targetValue - override.startValue) * eased;
    }

    // 保持期或释放期：返回目标值（新动画从此处开始过渡）
    return override.targetValue;
  }

  /**
   * 根据参数变化幅度自动计算过渡时长
   * 
   * 算法：normalizedDelta = |targetValue - startValue| / paramRange
   * duration = MIN_AUTO_DURATION + normalizedDelta * (MAX_AUTO_DURATION - MIN_AUTO_DURATION)
   * 
   * 效果：微小调整（眨眼）≈200ms 快速完成，大幅变化（转头）≈900ms 有重量感
   */
  private _computeTransitionDuration(parameterId: string, startValue: number, targetValue: number): number {
    const range = this._getParameterRange(parameterId);
    if (range <= 0) {
      return Live2DManager.FALLBACK_AUTO_DURATION_MS;
    }

    const normalizedDelta = Math.min(1, Math.abs(targetValue - startValue) / range);
    const durationRange = Live2DManager.MAX_AUTO_DURATION_MS - Live2DManager.MIN_AUTO_DURATION_MS;
    return Live2DManager.MIN_AUTO_DURATION_MS + normalizedDelta * durationRange;
  }

  /**
   * 获取模型参数的值域范围（max - min）
   * 用于计算归一化变化幅度
   */
  private _getParameterRange(parameterId: string): number {
    if (!this.model) return 0;
    try {
      const model = this.model as any;
      const coreModel = model.internalModel?.coreModel;
      if (!coreModel) return 0;
      const nativeModel = coreModel.getModel ? coreModel.getModel() : coreModel;
      if (!nativeModel?.parameters) return 0;
      const index = coreModel.getParameterIndex(parameterId);
      if (index < 0) return 0;
      return nativeModel.parameters.maximumValues[index] - nativeModel.parameters.minimumValues[index];
    } catch {
      return 0;
    }
  }

  /**
   * 从模型获取当前参数值（用作缓动起始值）
   */
  private _getModelParameterValue(parameterId: string): number | null {
    if (!this.model) return null;
    try {
      const model = this.model as any;
      const coreModel = model.internalModel?.coreModel;
      if (!coreModel) return null;
      const index = coreModel.getParameterIndex(parameterId);
      if (index < 0) return null;
      return coreModel.getParameterValueByIndex(index);
    } catch {
      return null;
    }
  }

  /**
   * easeInOutCubic 缓动函数
   * t: 0 → 1 的进度值
   * 返回: 缓动后的 0 → 1 值
   */
  private static _easeInOutCubic(t: number): number {
    return t < 0.5
      ? 4 * t * t * t
      : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  /**
   * 在 beforeModelUpdate 钩子中应用口型同步
   * 直接在渲染前写入嘴部参数，保证不被 SDK 内部流程覆盖
   */
  private applyLipSync(internalModel: any): void {
    if (!this.lipSyncEnabled) return;

    const coreModel = internalModel?.coreModel;
    if (!coreModel) return;

    // 非对称平滑：张嘴快（跟上音节）、闭嘴适中（音节间自然合拢）
    const LIP_SYNC_ATTACK = 0.6;
    const LIP_SYNC_RELEASE = 0.3;
    const smoothing = this.lipSyncTarget > this.lipSyncValue ? LIP_SYNC_ATTACK : LIP_SYNC_RELEASE;
    this.lipSyncValue += (this.lipSyncTarget - this.lipSyncValue) * smoothing;

    const DEFAULT_LIP_SYNC_PARAM = 'ParamMouthOpenY';
    const params = this.lipSyncParams.length > 0 ? this.lipSyncParams : [DEFAULT_LIP_SYNC_PARAM];
    for (const paramId of params) {
      try {
        coreModel.setParameterValueById(paramId, this.lipSyncValue);
      } catch {
        // 参数不存在
      }
    }
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
   * 修补 SDK 内部 hitAreas 对象
   * SDK 的 setupHitAreas() 以 model3.json 的 Name 为 key 存入对象
   * 当多个 HitArea 的 Name 都为空字符串时会发生 key 碰撞（后者覆盖前者）
   * 此方法使用 getHitAreaDefs() 获取完整列表，以 Name（优先）或 Id 为 key 重建
   */
  private patchHitAreas(live2dModel: any): void {
    const internalModel = live2dModel.internalModel;
    if (!internalModel || typeof internalModel.getHitAreaDefs !== 'function') return;

    const defs: Array<{ id: string; name: string; index: number }> = internalModel.getHitAreaDefs();
    if (!defs || defs.length === 0) return;

    // 检查是否存在 Name 碰撞
    const nameSet = new Set(defs.map(d => d.name));
    const hasCollision = nameSet.size < defs.length;
    if (!hasCollision) return;

    // 重建 hitAreas：Name 不为空且唯一时用 Name，否则用 Id
    const usedKeys = new Set<string>();
    const patchedHitAreas: Record<string, { id: string; name: string; index: number }> = {};
    for (const def of defs) {
      let key = def.name;
      if (!key || usedKeys.has(key)) {
        // Name 为空或重复，fallback 到 Id
        key = def.id;
      }
      if (key && !usedKeys.has(key)) {
        usedKeys.add(key);
        patchedHitAreas[key] = def;
      }
    }

    internalModel.hitAreas = patchedHitAreas;
    window.logger?.info('Live2D修补hitAreas', {
      original: defs.length,
      patched: Object.keys(patchedHitAreas)
    });
  }

  /**
   * 检测模型的 LipSync 参数组
   * 从 model3.json 的 Groups 中读取 LipSync 组的 Ids
   * 不同模型可能使用 ParamMouthOpenY、ParamA 等不同参数
   */
  private detectLipSyncParams(live2dModel: any): void {
    this.lipSyncParams = [];
    const internalModel = live2dModel.internalModel;
    if (!internalModel) return;

    // 尝试从 settings.json.Groups 读取 LipSync 组
    const groups: Array<{ Target: string; Name: string; Ids: string[] }> | undefined =
      internalModel.settings?.json?.Groups;
    if (Array.isArray(groups)) {
      const LIP_SYNC_GROUP_NAME = 'LipSync';
      const lipSyncGroup = groups.find(g => g.Name === LIP_SYNC_GROUP_NAME);
      if (lipSyncGroup && Array.isArray(lipSyncGroup.Ids)) {
        this.lipSyncParams = lipSyncGroup.Ids;
        window.logger?.info('Live2D检测到LipSync参数', { params: this.lipSyncParams });
        return;
      }
    }

    window.logger?.debug('Live2D未找到LipSync参数组，将使用默认参数');
  }

  /**
   * 销毁 Live2D
   */
  public destroy(): void {
    if (this.modelUpdateCleanup) {
      this.modelUpdateCleanup();
      this.modelUpdateCleanup = null;
    }
    this.parameterOverrides.clear();
    if (this.app) {
      this.app.destroy(true, { children: true });
      this.app = null;
    }
    this.model = null;
    this.lipSyncEnabled = false;
    this.lipSyncParams = [];
    this.initialized = false;
  }

  /**
   * 设置口型同步目标值（由音频播放器调用）
   * 实际嘴部参数写入由 beforeModelUpdate 钩子中的 applyLipSync() 完成
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
