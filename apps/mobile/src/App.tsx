import { useEffect, useRef, useState } from "react";
import { Alert, Image, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as Crypto from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import * as SecureStore from "expo-secure-store";
import { NativeVideoEditor } from "@ai-video/plugin-video-edit/native";
import type { NativeEditView, NativeRenderView } from "@ai-video/plugin-video-edit/native";
import type { VideoEditCommand } from "@ai-video/plugin-video-edit/core";
import { nativePalette as c } from "@ai-video/ui-native";
import type { CloudAccountSnapshot, CloudProjectSnapshot, CloudRunSnapshot } from "@ai-video/project-core";
import { ApiError, getApiUrl, mediaHeaders, objectUrl, request, restoreApi, setApiUrl, uploadPhoto } from "./api";
import { commandFromSnapshot } from "./sync-command";
import { mobilePlugins } from "./plugins";

type Account = CloudAccountSnapshot;
type Project = CloudProjectSnapshot;
type Run = CloudRunSnapshot;
interface CommandConflict { resourceType: "asset" | "episode"; resourceId: string; payload: unknown; localRevision: number; remote: Project }
const editEnabled = mobilePlugins.some(plugin => plugin.id === "video-edit");

export default function App() {
  const [serverUrl, setServerUrl] = useState("");
  const [account, setAccount] = useState<Account | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [register, setRegister] = useState(false);
  const [projects, setProjects] = useState<Pick<Project, "id" | "title">[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [episodeId, setEpisodeId] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [sourceAssetId, setSourceAssetId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [run, setRun] = useState<Run | null>(null);
  const [edit, setEdit] = useState<NativeEditView | null>(null);
  const [render, setRender] = useState<NativeRenderView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState<CommandConflict | null>(null);
  const requestId = useRef<string | null>(null);
  const approvalId = useRef<string | null>(null);
  const renderId = useRef<string | null>(null);
  const activeEpisode = project?.document.episodes.find(item => item.id === episodeId);

  useEffect(() => {
    void restoreApi().then(async url => {
      setServerUrl(url);
      if (!url) return;
      try { const me = await request<{ account: Account }>("/auth/me"); setAccount(me.account); }
      catch { /* session expired */ }
    });
  }, []);
  useEffect(() => { if (account) void loadProjects(); }, [account?.id]);

  async function loadProjects() {
    try { setProjects((await request<{ projects: Pick<Project, "id" | "title">[] }>("/projects")).projects); }
    catch (cause) { setError(String(cause)); }
  }

  async function authenticate() {
    try {
      setBusy(true); setError("");
      await setApiUrl(serverUrl);
      await request(`/auth/${register ? "register" : "login"}`, "POST", { email, password });
      setAccount((await request<{ account: Account }>("/auth/me")).account);
      setPassword("");
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }

  async function openProject(id: string) {
    try {
      const fresh = (await request<{ project: Project }>(`/projects/${id}`)).project;
      setProject(fresh); setConflict(null); setEpisodeId(fresh.document.episodes[0]?.id ?? "");
      setSourceAssetId(fresh.document.assets.find(item => item.kind === "image")?.id ?? "");
      setRun((await request<{ runs: Run[] }>(`/projects/${id}/runs`)).runs[0] ?? null);
      requestId.current = null; approvalId.current = null;
    } catch (cause) { setError(String(cause)); }
  }

  async function createProject() {
    if (!newTitle.trim()) return;
    try {
      setBusy(true);
      const created = (await request<{ project: Project }>("/projects", "POST", { title: newTitle.trim() })).project;
      setNewTitle(""); await loadProjects(); await openProject(created.id);
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }

  async function sendCommand(type: "asset" | "episode", id: string, payload: unknown): Promise<Project> {
    if (!project) throw new Error("请先选择项目");
    const command = commandFromSnapshot(project, type, id, payload, Crypto.randomUUID());
    try {
      const changed = (await request<{ project: Project }>(`/projects/${project.id}/commands`, "POST", command)).project;
      setProject(changed); setConflict(null); return changed;
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        const remote = (await request<{ project: Project }>(`/projects/${project.id}`)).project;
        setConflict({ resourceType: type, resourceId: id, payload, localRevision: command.baseRevision, remote });
        throw new Error("该资源已在另一端修改，请先选择保留本次编辑或云端版本");
      }
      throw cause;
    }
  }

  async function resolveConflict(choice: "local" | "cloud") {
    if (!conflict) return;
    try {
      setBusy(true); setError("");
      if (choice === "cloud") { setProject(conflict.remote); setConflict(null); return; }
      const command = commandFromSnapshot(conflict.remote, conflict.resourceType, conflict.resourceId, conflict.payload, Crypto.randomUUID());
      const changed = (await request<{ project: Project }>(`/projects/${conflict.remote.id}/commands`, "POST", command)).project;
      setProject(changed); setConflict(null);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        try {
          const remote = (await request<{ project: Project }>(`/projects/${conflict.remote.id}`)).project;
          setConflict({ ...conflict, remote });
        } catch { /* Keep the local choice available for a later retry. */ }
      }
      setError(`冲突仍未解决：${String(cause)}`);
    }
    finally { setBusy(false); }
  }

  async function pickPhoto() {
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.9 });
      if (picked.canceled || !picked.assets[0]) return;
      setBusy(true);
      const asset = picked.assets[0];
      const mime = asset.mimeType === "image/png" ? "image/png" : "image/jpeg";
      const uploaded = await uploadPhoto(asset.uri, mime);
      await sendCommand("asset", uploaded.id, { id: uploaded.id, kind: "image", name: asset.fileName ?? "参考照片" });
      setSourceAssetId(uploaded.id);
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }

  async function plan() {
    if (!project || !episodeId || !sourceAssetId || !prompt.trim()) return;
    try {
      setBusy(true); setError("");
      requestId.current ??= Crypto.randomUUID();
      await SecureStore.setItemAsync("avs-pending-request", JSON.stringify({ projectId: project.id, requestId: requestId.current }));
      const planned = (await request<{ run: Run }>(`/projects/${project.id}/runs`, "POST", {
        clientRequestId: requestId.current, episodeId, sourceAssetId, input: prompt, durationSec: 5,
      })).run;
      setRun(planned); approvalId.current = null;
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }

  async function approve() {
    if (!run) return;
    try {
      setBusy(true); setError("");
      approvalId.current ??= Crypto.randomUUID();
      const approved = (await request<{ run: Run }>(`/runs/${run.runId}/approve`, "POST", { approvalId: approvalId.current, planHash: run.planHash })).run;
      setRun(approved);
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    if (!run || ["waiting_approval", "saved", "failed"].includes(run.state)) return;
    let live = true;
    const refresh = async () => {
      try {
        const next = (await request<{ run: Run }>(`/runs/${run.runId}`)).run;
        if (!live) return;
        setRun(next);
        if (next.state === "saved" && project) setProject((await request<{ project: Project }>(`/projects/${project.id}`)).project);
      } catch (cause) { if (live) setError(String(cause)); }
    };
    const timer = setInterval(() => { void refresh(); }, 5000);
    void refresh();
    return () => { live = false; clearInterval(timer); };
  }, [run?.runId, run?.state === "waiting_approval" || run?.state === "saved" || run?.state === "failed", project?.id]);

  async function openEdit(shotId: string) {
    if (!project) return;
    try {
      setBusy(true); setError("");
      setEdit((await request<{ edit: NativeEditView }>("/video-edits", "POST", { projectId: project.id, episodeId, shotId })).edit);
      setRender(null); renderId.current = null;
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }

  async function editCommand(command: VideoEditCommand, expectedRevision: number): Promise<NativeEditView> {
    if (!edit) throw new Error("视频编辑未打开");
    const updated = (await request<{ edit: NativeEditView }>(`/video-edits/${edit.id}/commands`, "POST", { commandId: Crypto.randomUUID(), expectedRevision, command })).edit;
    setEdit(updated); setRender(null); renderId.current = null; return updated;
  }

  async function renderEdit(revision: number) {
    if (!edit) return;
    renderId.current ??= Crypto.randomUUID();
    setRender((await request<{ render: NativeRenderView }>(`/video-edits/${edit.id}/render`, "POST", { renderOperationId: renderId.current, expectedRevision: revision })).render);
  }

  useEffect(() => {
    if (!render || ["succeeded", "failed"].includes(render.state)) return;
    let live = true;
    const refresh = async () => {
      try {
        const next = (await request<{ render: NativeRenderView }>(`/renders/${render.id}`)).render;
        if (!live) return;
        setRender(next);
        if (next.state === "succeeded" && edit && project) {
          const [freshEdit, freshProject] = await Promise.all([request<{ edit: NativeEditView }>(`/video-edits/${edit.id}`), request<{ project: Project }>(`/projects/${project.id}`)]);
          if (live) { setEdit(freshEdit.edit); setProject(freshProject.project); }
        }
      } catch (cause) { if (live) setError(String(cause)); }
    };
    const timer = setInterval(() => { void refresh(); }, 3000); void refresh();
    return () => { live = false; clearInterval(timer); };
  }, [render?.id, render?.state, edit?.id, project?.id]);

  async function useInTimeline(assetId: string) {
    const episode = project?.document.episodes.find(item => item.id === edit?.recipe.episodeId);
    if (!episode) throw new Error("分集不存在");
    const existing = episode.timelineClips?.length === episode.timeline.length &&
      episode.timelineClips.every((clip, index) => clip.assetId === episode.timeline[index])
      ? episode.timelineClips : episode.timeline.map((id, index) => ({
        id: `cloud-${episode.id}-${index}`, assetId: id, inMs: 0,
        outMs: (episode.shots.find(shot => shot.resultAssetId === id)?.durationSec ?? 5) * 1000, volume: 1,
      }));
    await sendCommand("episode", episode.id, { ...episode, timeline: [...episode.timeline, assetId],
      timelineClips: [...existing, { id: Crypto.randomUUID(), assetId, inMs: 0, outMs: 5000, volume: 1 }] });
    Alert.alert("已加入", "新版本已加入本集时间线，原有片段保持不变。");
  }

  const conflictPanel = conflict ? <View style={styles.conflictPanel} accessibilityLabel="同步冲突处理">
    <Text style={styles.section}>同步冲突：{conflict.resourceType === "episode" ? "分集" : "素材"}已在另一端修改</Text>
    <Text style={styles.hint}>本次编辑基于修订 {conflict.localRevision}。选择云端会放弃本次编辑；选择本地会明确覆盖该资源的云端版本。</Text>
    <View style={styles.row}>
      <Pressable style={styles.button} disabled={busy} onPress={() => void resolveConflict("cloud")}><Text style={styles.text}>采用云端版本</Text></Pressable>
      <Pressable style={styles.primary} disabled={busy} onPress={() => void resolveConflict("local")}><Text style={styles.primaryText}>保留本次编辑并覆盖</Text></Pressable>
    </View>
  </View> : null;

  if (edit && editEnabled) return <SafeAreaView style={styles.root}><NativeVideoEditor edit={edit} sourceUrl={objectUrl(edit.sourceAssetId)} currentUrl={edit.currentOutputId ? objectUrl(edit.currentOutputId) : undefined} mediaHeaders={mediaHeaders()} render={render} newId={Crypto.randomUUID} onCommand={editCommand} onRender={renderEdit} onUseInTimeline={useInTimeline} onClose={() => setEdit(null)} />{conflictPanel && <View style={styles.conflictOverlay}>{conflictPanel}</View>}</SafeAreaView>;

  return <SafeAreaView style={styles.root}><ScrollView contentContainerStyle={styles.content}>
    <View style={styles.header}><Text style={styles.brand}>✦ AI Video Studio</Text>{account && <Pressable onPress={() => void request("/auth/logout", "POST").then(() => { setAccount(null); setProject(null); })}><Text style={styles.link}>退出</Text></Pressable>}</View>
    {!account ? <View style={styles.panel}><Text style={styles.title}>云端创作</Text><TextInput style={styles.input} accessibilityLabel="服务器地址" placeholder="http://192.168.1.10:8787" value={serverUrl} onChangeText={setServerUrl} autoCapitalize="none" /><TextInput style={styles.input} accessibilityLabel="邮箱" placeholder="邮箱" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" /><TextInput style={styles.input} accessibilityLabel="密码" placeholder="密码" value={password} onChangeText={setPassword} secureTextEntry /><View style={styles.row}><Pressable onPress={() => setRegister(!register)}><Text style={styles.link}>{register ? "已有账号？登录" : "没有账号？注册"}</Text></Pressable><Pressable style={styles.primary} disabled={busy} onPress={() => void authenticate()}><Text style={styles.primaryText}>{register ? "注册" : "登录"}</Text></Pressable></View></View> : <>
      <Text style={styles.subtitle}>{account.email} · 剩余演示额度 {account.demo_quota - account.demo_reserved - account.demo_used}</Text>
      <View style={styles.panel}><Text style={styles.section}>项目</Text>{projects.map(item => <Pressable key={item.id} style={styles.listItem} onPress={() => void openProject(item.id)}><Text style={styles.text}>{item.title}</Text></Pressable>)}<View style={styles.row}><TextInput style={styles.input} accessibilityLabel="新项目名称" placeholder="新项目名称" value={newTitle} onChangeText={setNewTitle} /><Pressable style={styles.button} onPress={() => void createProject()}><Text style={styles.text}>创建</Text></Pressable></View></View>
      {project && <><Text style={styles.title}>{project.title}</Text><View style={styles.row}>{project.document.episodes.map(item => <Pressable key={item.id} style={styles.chip} onPress={() => setEpisodeId(item.id)}><Text style={styles.text}>{item.title}</Text></Pressable>)}</View>
        <View style={styles.panel}><Text style={styles.section}>照片生成视频</Text><Pressable style={styles.button} disabled={busy} onPress={() => void pickPhoto()}><Text style={styles.text}>选择并上传照片</Text></Pressable>{sourceAssetId ? <Image style={styles.photo} source={{ uri: objectUrl(sourceAssetId), headers: mediaHeaders() }} /> : <Text style={styles.hint}>请先选择参考照片</Text>}{project.document.assets.filter(item => item.kind === "image").map(item => <Pressable key={item.id} onPress={() => setSourceAssetId(item.id)}><Text style={styles.link}>{item.id === sourceAssetId ? "✓ " : ""}{item.name ?? item.id}</Text></Pressable>)}<TextInput style={[styles.input, styles.textArea]} accessibilityLabel="镜头需求" multiline placeholder="描述主体、场景和动作" value={prompt} onChangeText={value => { setPrompt(value); requestId.current = null; }} /><Text style={styles.hint}>新生成镜头固定 5 秒</Text><Pressable style={styles.primary} disabled={busy || !sourceAssetId || !prompt.trim()} onPress={() => void plan()}><Text style={styles.primaryText}>生成镜头计划</Text></Pressable></View>
        {run && <View style={styles.panel}><Text style={styles.section}>Agent 状态：{run.state}</Text><Text style={styles.hint}>任务 ID：{run.runId}</Text>{run.state === "waiting_approval" && <><Text style={styles.text}>{run.plan.steps[0]?.prompt}</Text><Text style={styles.hint}>确认后消耗 1 次演示额度</Text><Pressable style={styles.primary} onPress={() => Alert.alert("确认生成", "将由云端调用可灵生成视频。", [{ text: "取消" }, { text: "确认", onPress: () => void approve() }])}><Text style={styles.primaryText}>确认生成</Text></Pressable></>}{run.state === "unknown" && <Text style={styles.hint}>仅查询原任务，不会重复提交。</Text>}</View>}
        <View style={styles.panel}><Text style={styles.section}>{activeEpisode?.title} · 视频结果</Text>{activeEpisode?.shots.map(shot => <View key={shot.id} style={styles.listItem}><Text style={styles.text}>{shot.prompt || "生成镜头"}</Text><Pressable onPress={() => void openEdit(shot.id)}><Text style={styles.link}>微调视频</Text></Pressable></View>)}{!activeEpisode?.shots.length && <Text style={styles.hint}>该集还没有视频。</Text>}</View>
      </>}
    </>}
    {error && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}
    {conflictPanel}
    <Text style={styles.hint}>云端：{getApiUrl() || "未设置"} · 移动端支持生成、任务状态与视频微调</Text>
  </ScrollView></SafeAreaView>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background }, content: { padding: 16, gap: 16, paddingBottom: 44 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10 }, brand: { fontSize: 18, fontWeight: "700", color: c.text },
  title: { fontSize: 24, fontWeight: "700", color: c.text }, subtitle: { fontSize: 12, color: c.muted }, section: { fontSize: 16, fontWeight: "700", color: c.text },
  panel: { backgroundColor: c.surface, borderRadius: 16, borderWidth: 1, borderColor: c.border, padding: 16, gap: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  input: { flex: 1, minWidth: 120, borderWidth: 1, borderColor: c.border, borderRadius: 9, color: c.text, padding: 10 }, textArea: { minHeight: 80, textAlignVertical: "top" },
  button: { borderWidth: 1, borderColor: c.border, borderRadius: 9, padding: 10 }, primary: { borderRadius: 10, backgroundColor: c.primary, padding: 12, alignItems: "center" }, primaryText: { color: "#fff", fontWeight: "700" },
  text: { color: c.text }, link: { color: c.primary, fontWeight: "700" }, hint: { color: c.muted, fontSize: 12 }, error: { color: c.danger },
  chip: { paddingHorizontal: 10, paddingVertical: 7, borderWidth: 1, borderColor: c.border, borderRadius: 10 }, listItem: { borderTopWidth: 1, borderColor: c.border, paddingVertical: 10, gap: 6 }, photo: { width: "100%", height: 220, borderRadius: 12, resizeMode: "contain", backgroundColor: c.shell },
  conflictPanel: { backgroundColor: c.surface, borderWidth: 2, borderColor: c.danger, borderRadius: 14, padding: 16, gap: 12 },
  conflictOverlay: { position: "absolute", left: 16, right: 16, bottom: 16 },
});
