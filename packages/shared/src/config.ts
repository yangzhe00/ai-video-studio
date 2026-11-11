/**
 * 全站可配置常量（constitution：数值默认值集中此处，禁止散落硬编码）
 */
export const CONFIG = {
  /** 选题每次生成条数（已确认 5 条） */
  topicCount: 5,
  /** 讲稿每段目标时长（秒），已确认 5-10 秒/段 */
  scriptSegmentMinSeconds: 5,
  scriptSegmentMaxSeconds: 10,
  /** 超时阈值（秒）：生视频 15min / 合成 30min */
  videoGenTimeoutSec: 15 * 60,
  composeTimeoutSec: 30 * 60,
  /** 额度预警阈值：剩余 20% */
  quotaWarnRatio: 0.2,
  /** 素材单文件上限 20MB */
  assetMaxSizeMB: 20,
  /** 素材允许格式 */
  assetMimeTypes: ['image/jpeg', 'image/png', 'image/webp'] as const,
  /** 版本历史保留最近 10 版 */
  maxVersionsPerTopic: 10,
  /** 验证码有效期与重发间隔 */
  smsCodeTtlSec: 300,
  smsResendIntervalSec: 60,
  /** 任务状态轮询间隔 ms */
  taskPollIntervalMs: 5000,
  /** 额度默认初始余额（演示用） */
  defaultQuota: 1000,
} as const
