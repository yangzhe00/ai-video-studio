const key = process.env.CURSOR_API_KEY;
if (!key) {
  process.stderr.write("CURSOR_API_KEY is not configured\n");
  process.exitCode = 1;
} else {
  try {
    const response = await fetch("https://api.cursor.com/v1/models", {
      headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      process.stderr.write(`Cursor model list failed: HTTP ${response.status}\n`);
      process.exitCode = 1;
    } else {
      const payload = await response.json();
      if (!Array.isArray(payload?.items)) throw new Error("Unexpected model list response");
      for (const model of payload.items) {
        if (typeof model?.id !== "string" || typeof model?.displayName !== "string") continue;
        process.stdout.write(`${model.id}\t${model.displayName}\n`);
        for (const variant of model.variants ?? []) {
          if (typeof variant?.displayName === "string") process.stdout.write(`  variant: ${variant.displayName}\n`);
        }
      }
    }
  } catch {
    process.stderr.write("Cursor model list request failed\n");
    process.exitCode = 1;
  }
}
