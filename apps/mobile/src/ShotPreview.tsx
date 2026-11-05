import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import { nativePalette as c } from "@ai-video/ui-native";

function Player({ url, headers }: { url: string; headers: Record<string, string> }) {
  const player = useVideoPlayer({ uri: url, headers });
  const [status, setStatus] = useState(player.status);
  useEffect(() => {
    const listener = player.addListener("statusChange", event => setStatus(event.status));
    return () => listener.remove();
  }, [player]);
  return <View style={styles.container}>
    <Text style={styles.label}>镜头预览</Text>
    <VideoView player={player} style={styles.video} nativeControls contentFit="contain" />
    {status === "loading" && <Text style={styles.hint}>视频加载中…</Text>}
    {status === "error" && <Text style={styles.error} accessibilityRole="alert">视频加载失败，请检查网络或稍后重试。</Text>}
  </View>;
}

export function ShotPreview({ url, headers }: { url: string; headers: Record<string, string> }) {
  const [attempt, setAttempt] = useState(0);
  return <View style={styles.container}>
    <Player key={attempt} url={url} headers={headers} />
    <Pressable accessibilityRole="button" onPress={() => setAttempt(value => value + 1)}>
      <Text style={styles.retry}>重新加载视频</Text>
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  container: { gap: 8 },
  label: { color: c.text, fontWeight: "700" },
  video: { width: "100%", aspectRatio: 9 / 16, maxHeight: 420, backgroundColor: "#000", borderRadius: 12 },
  hint: { color: c.muted },
  error: { color: c.danger },
  retry: { color: c.primary, fontWeight: "700" },
});
