import { create } from 'zustand'
import type { Script, Topic } from '@taskify/shared'

interface WorkspaceState {
  /** 当前选题（跨页面续作，交互定义 §3 中断续作） */
  topic: Topic | null
  script: Script | null
  setTopic: (topic: Topic | null) => void
  setScript: (script: Script | null) => void
  patchScript: (script: Script) => void
}

/** 创作上下文（选题/讲稿在各页面间共享，避免重复选择） */
export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  topic: null,
  script: null,
  setTopic: (topic) => set({ topic }),
  setScript: (script) => set({ script }),
  patchScript: (script) => set({ script }),
}))
