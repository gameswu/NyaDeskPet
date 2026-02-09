# 模型文件说明

本项目需要以下模型文件才能正常运行。由于文件较大，未包含在 Git 仓库中，请按照以下说明下载。

## 📁 目录结构

```
models/
├── live2d/          # Live2D 模型
│   └── mao_pro_zh/  # 默认公开模型
└── asr/             # 语音识别模型
    └── sense-voice-small/
```

## 🎭 Live2D 模型

### mao_pro_zh (默认模型)

- **大小**: 约 70MB
- **格式**: Live2D Cubism 3.0
- **下载地址**: https://cubism.live2d.com/sample-data/bin/mao_pro/mao_pro_zh.zip
- **安装位置**: `models/live2d/mao_pro_zh/`
- **目录结构**:
  ```
  mao_pro_zh/
  ├── runtime/
  │   ├── mao_pro.model3.json  # 主配置文件
  │   ├── mao_pro.moc3         # 模型数据
  │   ├── mao_pro.physics3.json
  │   ├── mao_pro.pose3.json
  │   ├── mao_pro.4096/        # 贴图
  │   ├── expressions/         # 表情
  │   └── motions/             # 动作
  └── ...
  ```

## 🗣️ 语音识别模型

### Sherpa-ONNX Sense-Voice-Small (INT8)

- **大小**: 约 228MB
- **框架**: ONNX Runtime
- **下载地址**: 
  - GitHub Release: https://github.com/k2-fsa/sherpa-onnx/releases/
  - ModelScope: https://www.modelscope.cn/models/pkufool/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17
- **安装位置**: `models/asr/sense-voice-small/`
- **需要的文件**:
  ```
  sense-voice-small/
  ├── model.int8.onnx    # INT8 量化模型（必需）
  └── tokens.txt         # 词表文件（必需）
  ```

### 下载步骤

1. 访问上述下载地址之一
2. 下载 `sense-voice-small` 模型包
3. 解压后将 `model.int8.onnx` 和 `tokens.txt` 放入 `models/asr/sense-voice-small/` 目录
4. 确保文件路径正确：
   ```bash
   models/asr/sense-voice-small/model.int8.onnx
   models/asr/sense-voice-small/tokens.txt
   ```

## ⚠️ 注意事项

1. **Live2D 模型**: 如果您使用自己的模型，请确保是 Cubism 3.0+ 格式
2. **ASR 模型**: 必须使用 INT8 量化版本，FP32 版本文件更大且未经测试
3. **路径配置**: 模型路径可在应用的设置面板中修改
4. **版权说明**: 
   - `mao_pro_zh` 模型版权归原作者所有
   - Sherpa-ONNX 模型遵循其原始许可证

## 🔧 开发者说明

如果您想使用其他 Live2D 模型：

1. 将模型文件放入 `models/live2d/` 目录
2. 在应用设置中修改模型路径为相对路径，例如：
   ```
   ../models/live2d/your_model/runtime/model.model3.json
   ```
3. 确保模型包含完整的 expressions 和 motions 目录

如果您想使用其他 ASR 模型：

1. 确保模型兼容 Sherpa-ONNX 框架
2. 修改 `src/asr-service.ts` 中的配置
3. 更新模型路径和参数
