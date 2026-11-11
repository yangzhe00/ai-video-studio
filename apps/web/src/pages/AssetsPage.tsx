import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import type { Asset } from '@taskify/shared'
import { CONFIG } from '@taskify/shared'
import { api } from '@taskify/api-client'
import { Button, EmptyState, Input, PageHeader, Skeleton } from '@taskify/ui'

/** 素材库页（B 域：批量上传 FR-B-02 / 站内 AI 生图 FR-B-01） */
export function AssetsPage(): React.ReactElement {
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)
  const [assets, setAssets] = useState<Asset[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function refresh(): Promise<void> {
    try {
      setAssets(await api.listAssets())
    } catch (e) {
      setError(e instanceof Error ? e.message : '素材加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  /** 批量上传（格式/大小后端校验，失败给出明确提示） */
  async function handleUpload(files: FileList | null): Promise<void> {
    if (!files || files.length === 0) return
    setUploading(true)
    setError(null)
    try {
      await api.uploadAssets(Array.from(files))
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : '上传失败')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  /** AI 生图：提交任务后轮询直到入库 */
  async function handleGenerate(): Promise<void> {
    if (!prompt.trim()) return
    const submitted = prompt.trim()
    setGenerating(true)
    setError(null)
    try {
      const { taskId } = await api.generateImage(submitted)
      const timer = window.setInterval(() => {
        void (async () => {
          const tasks = await api.listTasks({ type: 'image_gen' })
          const t = tasks.find((x) => x.id === taskId)
          if (t && (t.state === 'success' || t.state === 'failed')) {
            window.clearInterval(timer)
            setGenerating(false)
            if (t.state === 'failed') setError(t.failDetail ?? '生图失败')
            else {
              // 仅在用户没有继续输入时才清空，避免回写覆盖刚输入的下一条描述
              setPrompt((cur) => (cur.trim() === submitted ? '' : cur))
              await refresh()
            }
          }
        })()
      }, CONFIG.taskPollIntervalMs)
    } catch (e) {
      setGenerating(false)
      setError(e instanceof Error ? e.message : '生图任务提交失败')
    }
  }

  return (
    <div>
      <PageHeader
        title="素材库"
        description={`支持 jpg/png/webp，单文件 ≤ ${CONFIG.assetMaxSizeMB}MB`}
        actions={
          <Button variant="secondary" onClick={() => void refresh()}>
            刷新
          </Button>
        }
      />

      <section className="grid-2" style={{ marginBottom: 'var(--space-5)' }}>
        <div className="card card--pad">
          <h2 className="card__title" style={{ marginBottom: 'var(--space-3)' }}>
            上传本地图片
          </h2>
          <label
            className="dropzone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              void handleUpload(e.dataTransfer.files)
            }}
          >
            <span>点击选择或拖拽图片到此处</span>
            <span className="meta">可多选批量上传</span>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept={CONFIG.assetMimeTypes.join(',')}
              style={{ display: 'none' }}
              onChange={(e) => void handleUpload(e.target.files)}
            />
          </label>
          {uploading && <p className="hint" style={{ marginTop: 8 }}>上传中…</p>}
        </div>

        <div className="card card--pad">
          <h2 className="card__title" style={{ marginBottom: 'var(--space-3)' }}>
            站内 AI 生图
          </h2>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--space-2)' }}>
            <div style={{ flex: 1 }}>
              <Input
                label="画面描述"
                name="prompt"
                placeholder="例如：明亮卧室，衣柜收纳整齐"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
            </div>
            <Button loading={generating} disabled={!prompt.trim()} onClick={handleGenerate}>
              生成图片
            </Button>
          </div>
          <p className="hint" style={{ marginTop: 8 }}>
            生成结果自动入素材库，来源标记为「AI 生图」
          </p>
        </div>
      </section>

      {error && <p className="alert alert--error" style={{ marginBottom: 'var(--space-4)' }}>{error}</p>}

      <h2 className="section-title">
        全部素材 <span className="section-title__count">{assets.length}</span>
      </h2>
      {loading && <Skeleton rows={2} />}
      {!loading && assets.length === 0 && (
        <EmptyState
          title="素材库是空的"
          description="上传本地图片或使用站内 AI 生图"
          action={
            <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>
              上传图片
            </Button>
          }
        />
      )}
      <div className="grid-5">
        {assets.map((a) => (
          <figure key={a.id} className="card" style={{ overflow: 'hidden', margin: 0 }}>
            <img src={a.url} alt="素材" style={{ aspectRatio: '9 / 16', width: '100%', objectFit: 'cover', display: 'block' }} />
            <figcaption className="row-between" style={{ padding: '6px 10px' }}>
              <span className="meta">{a.source === 'generated' ? 'AI 生图' : '本地上传'}</span>
              <span className="meta">{(a.sizeBytes / 1024).toFixed(0)}KB</span>
            </figcaption>
          </figure>
        ))}
      </div>

      {assets.length > 0 && (
        <div style={{ marginTop: 'var(--space-6)' }}>
          <Button onClick={() => navigate('/generate')}>去关联片段</Button>
        </div>
      )}
    </div>
  )
}
