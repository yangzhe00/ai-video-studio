import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AssetUploadStatus, GeneratePage, SyncConflictDialog, TaskStatus, ThemeToggle } from "@ai-video/ui-web";
import { ProjectHome, ResultsPage, StudioShell, StudioTitleBar } from "@ai-video/components";
import type { StudioResult, StudioSection } from "@ai-video/components";
import type { AssetUploadItem, AssetUploadState } from "@ai-video/ui-web";
import {
  addStudioNode, appendClip, connectStudioNodes, createCharacter, createEpisode,
  createShotDraft, disconnectStudioNodes, ensureStudio, moveClip, moveStudioNode,
  removeStudioNode, selectEpisode, syncActiveEpisode, updateStudioNode,
} from "@ai-video/project-core";
import type { GenerationJob, OpenProject, ProjectManifestV2, StudioNode, StudioNodeType } from "@ai-video/project-core";
import { ProjectWorkspace } from "../workspace/ProjectWorkspace";
import { desktopPorts } from "../../lib/ports";
import { backupProject } from "../../lib/native";
import { hasDesktopFeature } from "../../lib/plugins";
import { CanvasPage } from "./CanvasPage";
import { StudioIcon } from "@ai-video/ui-web";
import { VideoEditor } from "@ai-video/plugin-video-edit/web";
import type { RenderView, VideoEditView } from "@ai-video/plugin-video-edit/web";
import type { VideoEditCommand } from "@ai-video/plugin-video-edit/core";
import { CloudAccountControl } from "../account/CloudAccountControl";
import { cloudRequest } from "../../lib/cloud";
import type { CloudAccount, CloudRun } from "../../lib/cloud";
import { ensureCloudReference, SyncConflictError, syncProject } from "../../lib/sync";
import type { CloudBinding } from "../../lib/sync";

interface Props { project: OpenProject; account: CloudAccount | null; onAccountChange: (account: CloudAccount | null) => void;
  onOpenProjects: () => void; ideaSlot?: ReactNode; incomingPrompt?: { id: string; prompt: string } | null; onIdeaConsumed?: () => void }
type View = "home" | "generate" | "canvas" | "results" | "editor" | "video-edit";
type SaveState = "saved" | "saving" | "failed";

function fileName(path: string) { return path.split("/").pop() ?? path; }

export function StudioWorkspace({ project, account, onAccountChange, onOpenProjects, ideaSlot, incomingPrompt, onIdeaConsumed }: Props) {
  const [manifest, setManifest] = useState<ProjectManifestV2>(() => ensureStudio(project.manifest));
  const manifestRef = useRef(manifest);
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const syncLock = useRef<Promise<void> | null>(null);
  const syncConflictRef = useRef<SyncConflictError | null>(null);
  const syncPaused = useRef(false);
  const conflictBackup = useRef<string | null>(null);
  const [view, setView] = useState<View>("generate");
  const [ideaPrompt, setIdeaPrompt] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [targetJob, setTargetJob] = useState<GenerationJob | null>(null);
  const [exporting, setExporting] = useState(false);
  const [syncState, setSyncState] = useState<"local" | "syncing" | "synced" | "conflict">("local");
  const [cloudRun, setCloudRun] = useState<CloudRun | null>(null);
  const [syncConflict, setSyncConflict] = useState<SyncConflictError | null>(null);
  const [uploadItems, setUploadItems] = useState<AssetUploadItem[]>([]);
  const [videoEdit, setVideoEdit] = useState<VideoEditView | null>(null);
  const [renderTask, setRenderTask] = useState<RenderView | null>(null);
  const renderRequestId = useRef<string | null>(null);
  const observedRun = useRef("");
  const activeEpisode = manifest.studio!.episodes.find(episode => episode.id === manifest.studio!.activeEpisodeId)!;
  const cloudBinding = manifest.extensions?.cloudSync as CloudBinding | undefined;
  const validCloudBinding = Boolean(account && cloudBinding?.accountId === account.id && cloudBinding.projectId);
  const cloudLabel = !account ? "仅保存在本机" : syncState === "syncing" ? "云端同步中"
    : syncState === "conflict" ? "同步未完成" : !validCloudBinding ? "尚未同步到云端"
      : syncState === "synced" ? "已同步到云端" : "同步状态待确认";

  useEffect(() => {
    if (!incomingPrompt) return;
    setIdeaPrompt(incomingPrompt.prompt);
    setView("generate");
    onIdeaConsumed?.();
  }, [incomingPrompt?.id, incomingPrompt?.prompt]);
  const cloudPreview = (cloudId: string | null | undefined) => {
    if (!cloudId) return "";
    const localId = Object.entries(cloudBinding?.assetMap ?? {}).find(([, id]) => id === cloudId)?.[0] ?? cloudId;
    return previewUrls[localId] ?? "";
  };

  function adopt(next: ProjectManifestV2) {
    manifestRef.current = next;
    setManifest(next);
  }

  async function commit(change: (current: ProjectManifestV2) => ProjectManifestV2, syncAfterSave = true): Promise<ProjectManifestV2> {
    if (syncLock.current) await syncLock.current;
    const next = change(manifestRef.current);
    adopt(next);
    setSaveState("saving");
    const task = saveQueue.current.then(() => desktopPorts.projects.save(project.root, next));
    saveQueue.current = task.catch(() => {});
    try {
      await task;
      if (manifestRef.current === next) setSaveState("saved");
      if (account && syncAfterSave) void runSync().catch(() => {});
      return next;
    } catch (error) {
      setSaveState("failed");
      setMessage(`保存失败：${String(error)}`);
      throw error;
    }
  }

  function runSync(force = false): Promise<void> {
    if (!account) return Promise.reject(new Error("请先登录云端账号"));
    if (syncConflictRef.current || (syncPaused.current && !force)) return Promise.reject(new Error("同步冲突待处理，请点击同步后选择版本"));
    if (syncLock.current) return syncLock.current;
    const activeAccount = account;
    const task = (async () => {
      await saveQueue.current;
      setSyncState("syncing");
      try {
        const result = await syncProject(project.root, manifestRef.current, activeAccount);
        adopt(result.manifest);
        setSyncState("synced");
        if (result.direction === "pull") setMessage("已从云端同步项目和分集");
      } catch (error) {
        setSyncState("conflict");
        if (error instanceof SyncConflictError) { syncConflictRef.current = error; setSyncConflict(error); }
        setMessage(`云端同步失败：${String(error)}`);
        throw error;
      }
    })();
    syncLock.current = task;
    void task.finally(() => { if (syncLock.current === task) syncLock.current = null; }).catch(() => {});
    return task;
  }

  async function resolveSyncConflict(choice: "local" | "cloud") {
    const conflict = syncConflictRef.current;
    if (!account || !conflict) return;
    try {
      setBusy(true);
      if (!conflictBackup.current) conflictBackup.current = await backupProject(project.root);
      const result = await syncProject(project.root, manifestRef.current, account, {
        resourceType: conflict.resourceType, resourceId: conflict.resourceId, cloudRevision: conflict.cloudRevision, choice,
      });
      adopt(result.manifest);
      syncConflictRef.current = null; setSyncConflict(null); syncPaused.current = false;
      setSyncState("synced");
      setMessage(`冲突已处理，本地原项目备份：${conflictBackup.current}`);
    } catch (error) {
      if (error instanceof SyncConflictError) { syncConflictRef.current = error; setSyncConflict(error); }
      setMessage(`处理同步冲突失败：${String(error)}`);
    } finally { setBusy(false); }
  }

  function updateUpload(assetId: string, state: AssetUploadState, error?: string) {
    const asset = manifestRef.current.assets.find(item => item.id === assetId);
    const name = fileName(asset?.relativePath ?? assetId);
    setUploadItems(current => {
      const next = { id: assetId, name, state, error };
      return current.some(item => item.id === assetId)
        ? current.map(item => item.id === assetId ? next : item)
        : [...current, next];
    });
  }

  async function uploadReference(assetId: string): Promise<{ cloudAssetId: string; projectId: string }> {
    if (!account) throw new Error("请先登录云端账号");
    if (syncConflictRef.current || syncPaused.current) throw new Error("请先处理项目同步冲突，再提交生成任务");
    if (syncLock.current) await syncLock.current.catch(() => {});
    updateUpload(assetId, "uploading");
    const activeAccount = account;
    const task = (async () => {
      await saveQueue.current;
      const result = await ensureCloudReference(project.root, manifestRef.current, activeAccount, assetId);
      adopt(result.manifest);
      updateUpload(assetId, "synced");
      return result;
    })();
    const lock = task.then(() => {}, () => {});
    syncLock.current = lock;
    try {
      return await task;
    } catch (error) {
      updateUpload(assetId, "failed", String(error));
      throw error;
    } finally {
      if (syncLock.current === lock) syncLock.current = null;
    }
  }

  useEffect(() => {
    if (!account) { setSyncState("local"); return; }
    void runSync().catch(() => {});
    const timer = window.setInterval(() => { void runSync().catch(() => {}); }, 12_000);
    return () => window.clearInterval(timer);
  }, [account?.id, project.root]);

  useEffect(() => {
    if (!account) { setCloudRun(null); return; }
    let live = true;
    const refresh = async () => {
      const cloud = manifestRef.current.extensions?.cloudSync as CloudBinding | undefined;
      if (!cloud) return;
      try {
        const runs = (await cloudRequest<{ runs: CloudRun[] }>(`/projects/${cloud.projectId}/runs`)).runs;
        const latest = runs[0];
        if (!live || !latest) return;
        setCloudRun(latest);
        if (`${latest.runId}:${latest.state}` === observedRun.current) return;
        observedRun.current = `${latest.runId}:${latest.state}`;
        if (latest.state === "saved") await runSync();
        await trackRun(latest);
      } catch { /* next poll retries the same durable task */ }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 5_000);
    return () => { live = false; window.clearInterval(timer); };
  }, [account?.id, project.root]);

  async function approveCloudRun(run: CloudRun) {
    if (!account || busy) return;
    try {
      setBusy(true);
      const saved = manifestRef.current.extensions?.cloudSubmission as { runId?: string; approvalId?: string } | undefined;
      const approvalId = saved?.runId === run.runId && saved.approvalId ? saved.approvalId : crypto.randomUUID();
      await commit(current => ({ ...current, extensions: { ...current.extensions, cloudSubmission: { ...(current.extensions?.cloudSubmission as Record<string, unknown> | undefined), runId: run.runId, approvalId } } }), false);
      const submitted = (await cloudRequest<{ run: CloudRun }>(`/runs/${run.runId}/approve`, "POST", { approvalId, planHash: run.planHash })).run;
      await trackRun(submitted);
      setMessage("云端生成任务已确认");
    } catch (error) { setMessage(`确认失败：${String(error)}`); }
    finally { setBusy(false); }
  }

  async function openVideoEdit(job: GenerationJob) {
    if (!account) { setMessage("请先登录云端账号"); return; }
    try {
      setBusy(true);
      await runSync();
      const cloud = manifestRef.current.extensions?.cloudSync as CloudBinding | undefined;
      if (!cloud) throw new Error("项目尚未同步");
      const run = (await cloudRequest<{ run: CloudRun }>(`/runs/${job.id}`)).run;
      const edit = (await cloudRequest<{ edit: VideoEditView }>("/video-edits", "POST", {
        projectId: cloud.projectId, episodeId: run.episodeId, shotId: run.runId,
      })).edit;
      setVideoEdit(edit); setRenderTask(null); renderRequestId.current = null; setView("video-edit");
    } catch (error) { setMessage(`无法打开视频编辑：${String(error)}`); }
    finally { setBusy(false); }
  }

  async function saveVideoEdit(command: VideoEditCommand, expectedRevision: number): Promise<VideoEditView> {
    if (!videoEdit) throw new Error("视频编辑未打开");
    const changed = (await cloudRequest<{ edit: VideoEditView }>(`/video-edits/${videoEdit.id}/commands`, "POST", {
      commandId: crypto.randomUUID(), expectedRevision, command,
    })).edit;
    setVideoEdit(changed); setRenderTask(null); renderRequestId.current = null;
    return changed;
  }

  async function renderVideoEdit(revision: number) {
    if (!videoEdit) throw new Error("视频编辑未打开");
    renderRequestId.current ??= crypto.randomUUID();
    const created = (await cloudRequest<{ render: RenderView }>(`/video-edits/${videoEdit.id}/render`, "POST", {
      renderOperationId: renderRequestId.current, expectedRevision: revision,
    })).render;
    setRenderTask(created);
  }

  useEffect(() => {
    if (!renderTask || ["succeeded", "failed"].includes(renderTask.state)) return;
    let live = true;
    const poll = async () => {
      try {
        const next = (await cloudRequest<{ render: RenderView }>(`/renders/${renderTask.id}`)).render;
        if (!live) return;
        setRenderTask(next);
        if (next.state === "succeeded" && videoEdit) {
          await runSync();
          const fresh = (await cloudRequest<{ edit: VideoEditView }>(`/video-edits/${videoEdit.id}`)).edit;
          if (live) setVideoEdit(fresh);
        }
      } catch (error) { if (live) setMessage(`查询渲染失败：${String(error)}`); }
    };
    const timer = window.setInterval(() => { void poll(); }, 3000);
    void poll();
    return () => { live = false; window.clearInterval(timer); };
  }, [renderTask?.id, renderTask?.state, videoEdit?.id]);

  async function useEditedInTimeline(cloudId: string) {
    if (!videoEdit) throw new Error("编辑记录不存在");
    await runSync();
    const cloud = manifestRef.current.extensions?.cloudSync as CloudBinding | undefined;
    const localId = Object.entries(cloud?.assetMap ?? {}).find(([, value]) => value === cloudId)?.[0] ?? cloudId;
    if (!manifestRef.current.assets.some(asset => asset.id === localId)) throw new Error("视频尚未下载到本地");
    await commit(current => {
      const episodeId = videoEdit.recipe.episodeId;
      const episode = current.studio!.episodes.find(item => item.id === episodeId)!;
      const timeline = episode.nodes.find(node => node.type === "timeline")!;
      const nodeId = crypto.randomUUID();
      const added = addStudioNode(current, episodeId, { id: nodeId, type: "video", title: cloudId === videoEdit.sourceAssetId ? "原视频" : "编辑版", resultAssetId: localId, x: 680, y: 145 });
      return syncActiveEpisode(appendClip(connectStudioNodes(added, episodeId, nodeId, timeline.id), localId));
    });
    setMessage(cloudId === videoEdit.sourceAssetId ? "已将原视频加入本集时间线" : "已将编辑版加入本集时间线");
  }

  async function change(operation: (current: ProjectManifestV2) => ProjectManifestV2) {
    try { await commit(operation); }
    catch (error) { if (!(String(error).includes("保存失败"))) setMessage(String(error)); }
  }

  useEffect(() => {
    if (project.manifest.studio) return;
    void commit(current => current);
  }, [project.root, project.manifest.studio]);

  useEffect(() => {
    let live = true;
    void desktopPorts.media.audit(project.root, project.manifest.assets).then(assets => {
      if (!live) return;
      if (JSON.stringify(assets) !== JSON.stringify(manifestRef.current.assets)) {
        void change(current => ({ ...current, assets }));
      }
    }).catch(error => { if (live) setMessage(`素材检查失败：${String(error)}`); });
    return () => { live = false; };
  }, [project.root, project.manifest.assets]);

  const assetKey = manifest.assets.map(asset => `${asset.id}:${asset.missing}`).join("|");
  useEffect(() => {
    let live = true;
    const urls: string[] = [];
    const assets = manifestRef.current.assets.filter(asset => !asset.missing && asset.kind !== "audio");
    void Promise.all(assets.map(async asset => {
      try {
        const bytes = await desktopPorts.media.read(project.root, asset.id);
        const ext = asset.relativePath.split(".").pop()?.toLowerCase();
        const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "mov" ? "video/quicktime" : "video/mp4";
        const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
        urls.push(url);
        return [asset.id, url] as const;
      } catch { return null; }
    })).then(entries => {
      if (live) setPreviewUrls(Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => entry !== null)));
      else urls.forEach(url => URL.revokeObjectURL(url));
    });
    return () => { live = false; urls.forEach(url => URL.revokeObjectURL(url)); };
  }, [assetKey, project.root]);

  async function importPhoto(): Promise<string | null> {
    try {
      const paths = await desktopPorts.media.chooseFiles();
      if (!paths.length) return null;
      setBusy(true);
      let firstImage: string | null = null;
      for (const path of paths) {
        const asset = await desktopPorts.media.import(project.root, path);
        await commit(current => ({ ...current, assets: [...current.assets, asset] }));
        if (!firstImage && asset.kind === "image") firstImage = asset.id;
      }
      setMessage(firstImage ? `已导入 ${paths.length} 个素材` : "已导入素材；生成视频需要 JPG 或 PNG 照片");
      return firstImage;
    } catch (error) { setMessage(`导入失败：${String(error)}`); return null; }
    finally { setBusy(false); }
  }

  function adoptRemote(next: ProjectManifestV2) {
    adopt(ensureStudio(next));
    setSaveState("saved");
  }

  function localJobState(state: string): GenerationJob["state"] {
    if (state === "saved") return "succeeded";
    if (state === "failed") return "failed";
    if (state === "unknown") return "unknown";
    if (state === "running") return "running";
    if (state === "downloading") return "download_pending";
    return "queued";
  }

  async function trackRun(run: CloudRun) {
    setCloudRun(run);
    const cloud = manifestRef.current.extensions?.cloudSync as CloudBinding | undefined;
    const episode = manifestRef.current.studio?.episodes.find(item => item.id === run.episodeId);
    const result = episode?.nodes.find(node => node.shotId === run.runId)?.resultAssetId ?? null;
    const next: GenerationJob = { id: run.runId, shotId: run.runId, provider: "kling", modelId: "kling-v2-5-turbo",
      state: localJobState(run.state), remoteId: run.operation?.id ?? null,
      estimatedUsd: 0, actualUsd: null, outputAssetId: result };
    await commit(current => ({ ...current, jobs: [...current.jobs.filter(job => job.id !== run.runId), next],
      extensions: { ...current.extensions, cloudTask: { runId: run.runId, projectId: cloud?.projectId } } }), false);
  }

  async function submitShot(sourceAssetId: string, prompt: string, durationSec: number, nodeId?: string) {
    try {
      if (!account) { setMessage("请先登录云端账号，再生成视频"); return; }
      const shot = createShotDraft(sourceAssetId, prompt, durationSec);
      setBusy(true);
      const clientRequestId = crypto.randomUUID();
      await commit(current => {
        let next = { ...current, shots: [...current.shots, shot] };
        if (nodeId) next = updateStudioNode(next, next.studio!.activeEpisodeId, nodeId, { shotId: shot.id, resultAssetId: undefined });
        return { ...next, extensions: { ...next.extensions, cloudSubmission: { clientRequestId, shotId: shot.id } } };
      }, false);
      const { cloudAssetId, projectId } = await uploadReference(sourceAssetId);
      const planned = (await cloudRequest<{ run: CloudRun }>(`/projects/${projectId}/runs`, "POST", {
        clientRequestId, episodeId: manifestRef.current.studio!.activeEpisodeId,
        sourceAssetId: cloudAssetId, input: prompt, durationSec,
      })).run;
      await commit(current => {
        let next = { ...current, shots: current.shots.map(item => item.id === shot.id ? { ...item, id: planned.runId } : item) };
        if (nodeId) next = updateStudioNode(next, next.studio!.activeEpisodeId, nodeId, { shotId: planned.runId });
        return next;
      }, false);
      await trackRun(planned);
      const approved = window.confirm(`镜头计划：${planned.plan.steps[0]?.prompt ?? prompt}\n时长 ${durationSec} 秒，将消耗 1 次演示额度并由云端调用可灵。确认开始？`);
      if (!approved) { setMessage("计划已保存，尚未调用生成服务"); return; }
      const approvalId = crypto.randomUUID();
      await commit(current => ({ ...current, extensions: { ...current.extensions, cloudSubmission: { clientRequestId, approvalId, runId: planned.runId, shotId: shot.id } } }), false);
      const submitted = (await cloudRequest<{ run: CloudRun }>(`/runs/${planned.runId}/approve`, "POST", { approvalId, planHash: planned.planHash })).run;
      await trackRun(submitted);
      setMessage("云端任务已提交，可查看执行状态与任务 ID");
    } catch (error) {
      setMessage(`提交失败：${String(error)}`);
      void desktopPorts.projects.open(project.root).then(adoptRemote).catch(() => {});
    } finally { setBusy(false); }
  }

  async function refreshJob(jobId: string) {
    try {
      setBusy(true);
      const cloud = manifestRef.current.extensions?.cloudSync as CloudBinding | undefined;
      if (account && cloud && (cloudRun?.runId === jobId || manifestRef.current.jobs.some(item => item.id === jobId && item.modelId === "kling-v2-5-turbo"))) {
        const run = (await cloudRequest<{ run: CloudRun }>(`/runs/${jobId}`)).run;
        if (run.state === "saved") await runSync();
        await trackRun(run);
        setMessage(run.state === "saved" ? "视频已同步到分集画布" : run.state === "unknown" ? "仅查询原任务，未重复提交" : `任务状态：${run.state}`);
        return;
      }
      const next = await desktopPorts.ai.refreshImageVideo(project.root, jobId);
      adoptRemote(next);
      const job = next.jobs.find(item => item.id === jobId);
      if (job?.state === "succeeded" && job.outputAssetId) {
        await commit(current => {
          let updated = current;
          for (const episode of current.studio?.episodes ?? []) {
            for (const node of episode.nodes.filter(item => item.shotId === job.shotId)) {
              updated = updateStudioNode(updated, episode.id, node.id, { resultAssetId: job.outputAssetId! });
            }
          }
          return updated;
        });
      }
      setMessage(job?.state === "succeeded" ? "视频已生成，可加入画布或时间线" : job?.state === "failed" ? "任务失败；再次生成需重新明确点击" : "已查询原任务，没有重新提交付费请求");
    } catch (error) {
      setMessage(`查询失败：${String(error)}`);
      void desktopPorts.projects.open(project.root).then(adoptRemote).catch(() => {});
    } finally { setBusy(false); }
  }

  async function addResultToEpisode(episodeId: string, job: GenerationJob) {
    if (!job.outputAssetId) return;
    try {
      await commit(current => {
        const chosen = selectEpisode(current, episodeId);
        return addResultNode(chosen, episodeId, job);
      });
      setTargetJob(null);
      setView("canvas");
    } catch (error) { setMessage(`加入画布失败：${String(error)}`); }
  }

  async function addResultToTimeline(job: GenerationJob) {
    if (!job.outputAssetId) return;
    try {
      await commit(current => {
        const episodeId = current.studio!.activeEpisodeId;
        let next = current;
        let episode = next.studio!.episodes.find(item => item.id === episodeId)!;
        let node = episode.nodes.find(item => item.shotId === job.shotId && item.type === "video");
        if (!node) {
          next = addResultNode(next, episodeId, job);
          episode = next.studio!.episodes.find(item => item.id === episodeId)!;
          node = episode.nodes.find(item => item.shotId === job.shotId && item.type === "video");
        }
        const timeline = episode.nodes.find(item => item.type === "timeline")!;
        if (!node || episode.edges.some(edge => edge.from === node.id && edge.to === timeline.id)) return next;
        return syncActiveEpisode(appendClip(connectStudioNodes(next, episodeId, node.id, timeline.id), job.outputAssetId!));
      });
      setView("canvas"); setMessage("已加入本集时间线");
    } catch (error) { setMessage(`加入时间线失败：${String(error)}`); }
  }

  function addResultNode(current: ProjectManifestV2, episodeId: string, job: GenerationJob) {
    const episode = current.studio!.episodes.find(item => item.id === episodeId)!;
    const shot = current.shots.find(item => item.id === job.shotId);
    return addStudioNode(current, episodeId, {
      id: crypto.randomUUID(), type: "video", x: 666 + (episode.nodes.length % 2) * 26, y: 95 + (episode.nodes.length % 3) * 35,
      title: shot?.prompt.slice(0, 20) || "生成视频", shotId: job.shotId, resultAssetId: job.outputAssetId!,
    });
  }

  async function makeEpisode(job?: GenerationJob) {
    const title = window.prompt("新分集名称", `第 ${manifestRef.current.studio!.episodes.length + 1} 集`);
    if (title === null) return;
    try {
      await commit(current => {
        const created = createEpisode(current, title);
        return job?.outputAssetId ? addResultNode(created, created.studio!.activeEpisodeId, job) : created;
      });
      setTargetJob(null);
      setView("canvas");
    } catch (error) { setMessage(`新建分集失败：${String(error)}`); }
  }

  async function makeCharacter(name: string, description: string, assetId: string) {
    await change(current => {
      const created = createCharacter(current, name, description, assetId);
      const character = created.studio!.characters[created.studio!.characters.length - 1]!;
      return addStudioNode(created, created.studio!.activeEpisodeId, { id: crypto.randomUUID(), type: "character", x: 40, y: 184, title: character.name, characterId: character.id });
    });
  }

  async function addExistingCharacter(characterId: string) {
    await change(current => {
      const studio = current.studio!;
      const character = studio.characters.find(item => item.id === characterId);
      if (!character) throw new Error("人物不存在");
      const episode = studio.episodes.find(item => item.id === studio.activeEpisodeId)!;
      const count = episode.nodes.filter(node => node.type === "character").length;
      return addStudioNode(current, episode.id, { id: crypto.randomUUID(), type: "character", x: 40, y: 184 + count * 36, title: character.name, characterId });
    });
  }

  async function addNode(type: StudioNodeType, assetId?: string) {
    if (type === "character" || type === "timeline") return;
    await change(current => {
      const episode = current.studio!.episodes.find(item => item.id === current.studio!.activeEpisodeId)!;
      const count = episode.nodes.filter(node => node.type === type).length;
      const x = type === "text" ? 345 : type === "video" ? 666 : 45;
      const y = type === "text" ? 120 + count * 34 : type === "video" ? 95 + count * 36 : 250 + count * 35;
      const node: StudioNode = { id: crypto.randomUUID(), type, x, y, title: type === "text" ? `镜头描述 ${count + 1}` : type === "image" ? "参考图片" : `视频 / 镜头 ${count + 1}` };
      if (type === "image") node.assetId = assetId;
      if (type === "text") node.prompt = "";
      if (type === "video") node.durationSec = 5;
      return addStudioNode(current, episode.id, node);
    });
  }

  async function addDownstreamVideo(fromId: string) {
    await change(current => {
      const episodeId = current.studio!.activeEpisodeId;
      const episode = current.studio!.episodes.find(item => item.id === episodeId)!;
      const from = episode.nodes.find(item => item.id === fromId);
      if (!from || !["character", "image", "text"].includes(from.type)) throw new Error("此节点不能添加下游视频");
      const nodeId = crypto.randomUUID();
      const node: StudioNode = { id: nodeId, type: "video", x: Math.min(from.x + 375, 840), y: Math.max(90, from.y - 60), title: `视频 / 镜头 ${episode.nodes.filter(item => item.type === "video").length + 1}`, durationSec: 5 };
      return connectStudioNodes(addStudioNode(current, episodeId, node), episodeId, fromId, nodeId);
    });
  }

  async function addVideoToTimeline(nodeId: string, assetId: string) {
    try {
      await commit(current => {
        const episodeId = current.studio!.activeEpisodeId;
        const episode = current.studio!.episodes.find(item => item.id === episodeId)!;
        const timeline = episode.nodes.find(node => node.type === "timeline")!;
        if (episode.edges.some(edge => edge.from === nodeId && edge.to === timeline.id)) return current;
        return syncActiveEpisode(appendClip(connectStudioNodes(current, episodeId, nodeId, timeline.id), assetId));
      });
      setMessage("已加入本集时间线");
    } catch (error) { setMessage(`加入时间线失败：${String(error)}`); }
  }

  async function exportEpisode() {
    const current = manifestRef.current;
    const studio = current.studio!;
    const index = studio.episodes.findIndex(episode => episode.id === studio.activeEpisodeId);
    if (!current.clips.length) { setMessage("请先将视频加入整集时间线"); return; }
    try {
      setExporting(true);
      setMessage("正在导出当前分集…");
      const result = await desktopPorts.export.render(project.root, `episode-${index + 1}`);
      setMessage(`导出完成：${fileName(result.videoRelativePath)}`);
    } catch (error) { setMessage(`导出失败：${String(error)}`); }
    finally { setExporting(false); }
  }

  async function returnFromEditor() {
    try {
      const fresh = await desktopPorts.projects.open(project.root);
      const next = syncActiveEpisode(ensureStudio(fresh));
      adopt(next);
      await desktopPorts.projects.save(project.root, next);
      setView("canvas");
    } catch (error) { setMessage(`无法返回画布：${String(error)}`); }
  }

  const results: StudioResult[] = [...manifest.jobs].filter(job => job.provider === "kling").reverse().map(job => {
    const shot = manifest.shots.find(item => item.id === job.shotId);
    return { id: job.id, title: shot?.prompt?.slice(0, 25) || "生成镜头", description: shot?.prompt,
      durationSec: shot?.durationSec ?? 5, taskId: job.id, videoUrl: job.outputAssetId ? previewUrls[job.outputAssetId] : undefined,
      status: job.state === "succeeded" ? "succeeded" : job.state === "failed" ? "failed" : job.state === "unknown" ? "unknown" : "loading" };
  });
  const navigate = (section: StudioSection) => {
    if (section === "assets") { setView("editor"); return; }
    setView(section);
  };

  return <div className="film-app">
    <StudioTitleBar native onHome={() => setView("home")} tabs={[
      { id: "generate", label: "生成", active: view === "generate", onClick: () => setView("generate") },
      ...(hasDesktopFeature("canvas") ? [{ id: "canvas", label: `${activeEpisode.title} · ${manifest.title}`, active: view === "canvas", onClick: () => setView("canvas" as const) }] : []),
      { id: "results", label: "结果", active: view === "results", onClick: () => setView("results") },
      ...(view === "editor" ? [{ id: "editor", label: "剪辑工作台", active: true, onClick: () => void returnFromEditor() }] : []),
      ...(view === "video-edit" ? [{ id: "video-edit", label: "视频微调", active: true, onClick: () => setView("video-edit" as const) }] : []),
    ]} actions={<>
      <button type="button" className="cloud-sync-trigger" onClick={() => { if (account) void runSync(true).catch(() => {}); }}
        disabled={!account || syncState === "syncing"}>{cloudLabel}</button>
      <CloudAccountControl account={account} onChange={onAccountChange} /><ThemeToggle />
    </>} />
    {uploadItems.length > 0 && <AssetUploadStatus items={uploadItems} onRetry={assetId => { void uploadReference(assetId).catch(() => {}); }} />}
    <StudioShell active={view === "editor" ? "assets" : view === "video-edit" ? "results" : view} onNavigate={navigate}
      projectTitle={`${activeEpisode.title} · ${manifest.title}`}>
    {view === "home" ? <ProjectHome projectTitle={manifest.title} episodeTitle={activeEpisode.title}
      recentImage={manifest.assets.find(asset => asset.kind === "image")?.id ? previewUrls[manifest.assets.find(asset => asset.kind === "image")!.id] : undefined}
      recentMeta={`${activeEpisode.clips.length} 个片段 · 继续创作`} onCreate={onOpenProjects}
      onContinue={() => setView("generate")} onCanvas={() => setView("canvas")} ideaSlot={ideaSlot} />
      : view === "results" ? <ResultsPage results={results} episodeTitle={activeEpisode.title} storageLabel={cloudLabel}
        onGenerate={() => setView("generate")}
        onEdit={result => { const job = manifest.jobs.find(item => item.id === result.id); if (job) void openVideoEdit(job); }}
        onAddToTimeline={result => { const job = manifest.jobs.find(item => item.id === result.id); if (job) void addResultToTimeline(job); }}
        onRefresh={result => { void refreshJob(result.id); }} />
      : view === "generate" ? <GeneratePage manifest={manifest} previewUrls={previewUrls} busy={busy} saveState={saveState} initialPrompt={ideaPrompt}
      onImportPhoto={importPhoto} onGenerate={submitShot} onRefresh={refreshJob} onAddToCanvas={setTargetJob} onEditVideo={job => void openVideoEdit(job)}
      onOpenCanvas={() => setView("canvas")} onOpenEditor={() => setView("editor")} onOpenProjects={onOpenProjects} />
      : view === "canvas" && hasDesktopFeature("canvas") ? <CanvasPage manifest={manifest} episode={activeEpisode} projectRoot={project.root} previewUrls={previewUrls} busy={busy || exporting} saveState={saveState}
        onOpenGenerate={() => setView("generate")} onOpenEditor={() => setView("editor")} onOpenProjects={onOpenProjects}
        onSelectEpisode={id => void change(current => selectEpisode(current, id))} onCreateEpisode={() => void makeEpisode()}
        onImportPhoto={importPhoto} onCreateCharacter={(name, description, assetId) => void makeCharacter(name, description, assetId)}
        onAddCharacterNode={id => void addExistingCharacter(id)}
        onAddNode={(type, assetId) => void addNode(type, assetId)} onUpdateNode={(nodeId, changes) => void change(current => updateStudioNode(current, activeEpisode.id, nodeId, changes))}
        onAddDownstreamVideo={id => void addDownstreamVideo(id)}
        onMoveNode={(nodeId, x, y) => void change(current => moveStudioNode(current, activeEpisode.id, nodeId, x, y))}
        onRemoveNode={nodeId => void change(current => removeStudioNode(current, activeEpisode.id, nodeId))}
        onConnect={(from, to) => void change(current => connectStudioNodes(current, activeEpisode.id, from, to))}
        onDisconnect={edgeId => void change(current => disconnectStudioNodes(current, activeEpisode.id, edgeId))}
        onRunVideo={nodeId => {
          const episode = manifestRef.current.studio!.episodes.find(item => item.id === manifestRef.current.studio!.activeEpisodeId)!;
          const node = episode.nodes.find(item => item.id === nodeId);
          const parents = episode.edges.filter(edge => edge.to === nodeId).map(edge => episode.nodes.find(item => item.id === edge.from)).filter((item): item is StudioNode => Boolean(item));
          const image = parents.find(item => item.type === "image" || item.type === "character");
          const text = parents.find(item => item.type === "text");
          const character = manifestRef.current.studio!.characters.find(item => item.id === image?.characterId);
          const source = image?.type === "character" ? character?.assetId : image?.assetId ?? node?.assetId;
          const prompt = text?.prompt || node?.prompt;
          if (!source || !prompt?.trim()) { setMessage("请先连接参考照片和镜头描述"); return; }
          void submitShot(source, prompt, node?.durationSec ?? 5, nodeId);
        }}
        onRefreshJob={jobId => void refreshJob(jobId)}
        onAddVideoToTimeline={(nodeId, assetId) => void addVideoToTimeline(nodeId, assetId)}
        onReorderClip={(clipId, target) => void change(current => syncActiveEpisode(moveClip(current, clipId, target)))}
        onExport={() => void exportEpisode()} /> : view === "video-edit" && videoEdit ? <div className="film-cloud-video-edit"><VideoEditor edit={videoEdit} sourceUrl={cloudPreview(videoEdit.sourceAssetId)} currentUrl={cloudPreview(videoEdit.currentOutputId)} render={renderTask} onCommand={saveVideoEdit} onRender={renderVideoEdit} onUseInTimeline={useEditedInTimeline} onClose={() => setView("generate")} /></div> : null}
    {view === "editor" && <div className="film-editor-mode"><div className="film-editor-return"><button type="button" onClick={() => void returnFromEditor()}>← 返回画布</button><span>详细剪辑、字幕与发布设置</span></div><ProjectWorkspace key={project.root} project={{ root: project.root, manifest }} onCloudGenerate={() => setView("generate")} /></div>}
    </StudioShell>
    {targetJob && <div className="film-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setTargetJob(null); }}>
      <div className="film-modal" role="dialog" aria-modal="true" aria-label="选择分集画布">
        <div className="film-modal-title"><strong>加入哪一集？</strong><button type="button" onClick={() => setTargetJob(null)} aria-label="关闭"><StudioIcon name="x" size={18} /></button></div>
        <p>视频将作为节点加入画布，随后可以连接到整集时间线。</p>
        {manifest.studio!.episodes.map(episode => <button key={episode.id} type="button" className="film-episode-option" onClick={() => void addResultToEpisode(episode.id, targetJob)}><StudioIcon name="film" size={17} />{episode.title}<StudioIcon name="arrowRight" size={16} /></button>)}
        <button type="button" className="film-modal-secondary" onClick={() => void makeEpisode(targetJob)}>＋ 新建分集</button>
      </div>
    </div>}
    {syncConflict && <SyncConflictDialog projectTitle={manifest.title} busy={busy} resources={[{
      resourceType: syncConflict.resourceType, resourceId: syncConflict.resourceId,
      title: syncConflict.resourceId,
      local: { revision: syncConflict.localRevision, preview: JSON.stringify(syncConflict.localPayload, null, 2)?.slice(0, 800) ?? "本地新增内容" },
      cloud: { revision: syncConflict.cloudRevision, preview: JSON.stringify(syncConflict.cloudPayload, null, 2)?.slice(0, 800) ?? "云端尚无内容" },
    }]} onCancel={() => { syncPaused.current = true; syncConflictRef.current = null; setSyncConflict(null); }}
      onResolve={choices => { const choice = choices[`${syncConflict.resourceType}:${syncConflict.resourceId}`]; if (choice) void resolveSyncConflict(choice); }} />}
    {cloudRun && <div className="cloud-task-pill" role="status"><TaskStatus state={cloudRun.state as React.ComponentProps<typeof TaskStatus>["state"]} message={`任务 ID：${cloudRun.runId}`} />{cloudRun.state === "waiting_approval" && <button type="button" onClick={() => void approveCloudRun(cloudRun)}>确认生成</button>}{cloudRun.state !== "saved" && cloudRun.state !== "failed" && <button type="button" onClick={() => void refreshJob(cloudRun.runId)}>刷新</button>}</div>}
    {message && <div className="film-toast" role="status">{message}<button type="button" onClick={() => setMessage(null)} aria-label="关闭提示"><StudioIcon name="x" size={15} /></button></div>}
  </div>;
}
