import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import { validateRecipe } from "../core";
import type { VideoEditCommand, VideoEditRecipeV1 } from "../core";

export interface NativeEditView { id: string; recipe: VideoEditRecipeV1; sourceAssetId: string; currentOutputId: string | null; currentCoverId: string | null }
export interface NativeRenderView { id: string; state: string; outputAssetId: string | null; coverAssetId: string | null; error: string | null }
interface Props {
  edit: NativeEditView; sourceUrl: string; currentUrl?: string; render?: NativeRenderView | null;
  mediaHeaders?: Record<string, string>;
  newId: () => string;
  onCommand: (command: VideoEditCommand, expectedRevision: number) => Promise<NativeEditView>;
  onRender: (revision: number) => Promise<void>;
  onUseInTimeline?: (assetId: string) => Promise<void>;
  onClose: () => void;
}

const sec = (ms: number) => String(Math.round(ms / 100) / 10);
const ms = (value: string) => Math.round(Number(value) * 1000);
const colors = { background: "#f7f2eb", surface: "#fffcf8", text: "#2b2a26", muted: "#696b64", accent: "#b96c4a", border: "#d5c5b5" };

export function NativeVideoEditor({ edit, sourceUrl, currentUrl, render, mediaHeaders, newId, onCommand, onRender, onUseInTimeline, onClose }: Props) {
  const recipe = edit.recipe;
  const editedAvailable = Boolean(edit.currentOutputId && currentUrl);
  const [original, setOriginal] = useState(!editedAvailable);
  const player = useVideoPlayer({ uri: original || !currentUrl ? sourceUrl : currentUrl, headers: mediaHeaders });
  const [start, setStart] = useState(sec(recipe.trimStartMs));
  const [end, setEnd] = useState(sec(recipe.trimEndMs));
  const [cover, setCover] = useState(sec(recipe.coverSourceMs));
  const [caption, setCaption] = useState("");
  const [captionStart, setCaptionStart] = useState(sec(recipe.trimStartMs));
  const [captionEnd, setCaptionEnd] = useState(sec(Math.min(recipe.trimEndMs, recipe.trimStartMs + 2000)));
  const [busy, setBusy] = useState(false);
  const issues = validateRecipe(recipe);
  const selectedAssetId = original || !editedAvailable ? edit.sourceAssetId : edit.currentOutputId!;
  const selectedLabel = selectedAssetId === edit.sourceAssetId ? "原视频" : "编辑版";

  async function send(command: VideoEditCommand) {
    try { setBusy(true); await onCommand(command, recipe.revision); }
    catch (error) { Alert.alert("编辑失败", String(error)); }
    finally { setBusy(false); }
  }

  return <ScrollView style={styles.root} contentContainerStyle={styles.content}>
    <View style={styles.header}><Text style={styles.title}>视频微调</Text><Pressable onPress={onClose}><Text style={styles.link}>完成</Text></Pressable></View>
    <VideoView player={player} style={styles.video} nativeControls />
    <View style={styles.row}><Pressable onPress={() => setOriginal(true)} accessibilityRole="button" accessibilityState={{ selected: original || !editedAvailable }}><Text style={styles.link}>原视频</Text></Pressable><Pressable disabled={!editedAvailable} onPress={() => setOriginal(false)} accessibilityRole="button" accessibilityState={{ selected: !original && editedAvailable, disabled: !editedAvailable }}><Text style={styles.link}>编辑版</Text></Pressable></View>
    <Text style={styles.hint}>正在预览：{selectedLabel}。原视频保留，编辑版由云端渲染。时间以原视频为准。</Text>
    <View style={styles.panel}><Text style={styles.section}>裁剪首尾</Text><View style={styles.row}><TextInput style={styles.input} accessibilityLabel="裁剪开始秒数" keyboardType="decimal-pad" value={start} onChangeText={setStart} /><TextInput style={styles.input} accessibilityLabel="裁剪结束秒数" keyboardType="decimal-pad" value={end} onChangeText={setEnd} /></View><Pressable style={styles.button} disabled={busy} onPress={() => void send({ type: "set-trim", startMs: ms(start), endMs: ms(end) })}><Text style={styles.buttonText}>保存裁剪</Text></Pressable></View>
    <View style={styles.panel}><Text style={styles.section}>手动字幕</Text><TextInput style={styles.input} accessibilityLabel="字幕内容" placeholder="输入字幕" value={caption} onChangeText={setCaption} /><View style={styles.row}><TextInput style={styles.input} accessibilityLabel="字幕开始秒数" keyboardType="decimal-pad" value={captionStart} onChangeText={setCaptionStart} /><TextInput style={styles.input} accessibilityLabel="字幕结束秒数" keyboardType="decimal-pad" value={captionEnd} onChangeText={setCaptionEnd} /></View><Pressable style={styles.button} disabled={busy || !caption.trim()} onPress={() => { void send({ type: "upsert-caption", caption: { id: newId(), startMs: ms(captionStart), endMs: ms(captionEnd), text: caption } }); setCaption(""); }}><Text style={styles.buttonText}>添加字幕</Text></Pressable>{recipe.captions.map(item => <View key={item.id} style={styles.row}><Text style={styles.caption}>{sec(item.startMs)}–{sec(item.endMs)} 秒 · {item.text}</Text><Pressable onPress={() => void send({ type: "remove-caption", captionId: item.id })}><Text style={styles.link}>删除</Text></Pressable></View>)}{issues.length > 0 && <Text style={styles.warning}>{issues.length} 条字幕超出保留片段</Text>}</View>
    <View style={styles.panel}><Text style={styles.section}>封面帧</Text><TextInput style={styles.input} accessibilityLabel="封面时间秒数" keyboardType="decimal-pad" value={cover} onChangeText={setCover} /><Pressable style={styles.button} disabled={busy} onPress={() => void send({ type: "set-cover", sourceMs: ms(cover) })}><Text style={styles.buttonText}>保存封面时间</Text></Pressable></View>
    <Pressable style={styles.primary} disabled={busy || issues.length > 0 || render?.state === "running" || render?.state === "pending"} onPress={() => void onRender(recipe.revision).catch(error => Alert.alert("渲染失败", String(error)))}><Text style={styles.primaryText}>完成并云端渲染</Text></Pressable>
    {render && <Text style={styles.hint}>渲染状态：{render.state}{render.error ? ` · ${render.error}` : ""}</Text>}
    {onUseInTimeline && <Pressable style={styles.button} disabled={busy} onPress={() => void onUseInTimeline(selectedAssetId).catch(error => Alert.alert("加入失败", String(error)))}><Text style={styles.buttonText}>将{selectedLabel}加入本集时间线</Text></Pressable>}
  </ScrollView>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background }, content: { padding: 16, gap: 14, paddingBottom: 50 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, title: { fontSize: 24, fontWeight: "700", color: colors.text },
  video: { width: "100%", aspectRatio: 9 / 16, maxHeight: 360, backgroundColor: "#000", borderRadius: 12 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  panel: { padding: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 14, gap: 10 },
  section: { fontSize: 16, fontWeight: "700", color: colors.text }, input: { flex: 1, minWidth: 0, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, color: colors.text },
  button: { borderWidth: 1, borderColor: colors.border, borderRadius: 9, padding: 10, alignItems: "center" }, buttonText: { color: colors.text, fontWeight: "600" },
  primary: { backgroundColor: colors.accent, borderRadius: 10, padding: 14, alignItems: "center" }, primaryText: { color: "#fff", fontWeight: "700" },
  link: { color: colors.accent, fontWeight: "700" }, hint: { color: colors.muted, fontSize: 12 }, warning: { color: "#b54442", fontSize: 12 }, caption: { flex: 1, color: colors.text },
});
