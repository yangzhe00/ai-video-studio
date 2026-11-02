export interface EpisodeMediaOperation {
  id: string;
  state: "pending" | "running" | "succeeded" | "failed";
}

/** Keep the requested ID through an unknown POST result, then replace it with the server's actual replay ID. */
export async function resumeMediaOperation<T extends EpisodeMediaOperation>(
  storage: Storage,
  key: string,
  lookup: (id: string) => Promise<T>,
  create: (requestedId: string) => Promise<T>,
  isGone: (cause: unknown) => boolean,
): Promise<T> {
  let remembered = storage.getItem(key);
  if (remembered && !/^[a-zA-Z0-9-]{8,80}$/.test(remembered)) {
    storage.removeItem(key);
    remembered = null;
  }
  if (remembered) {
    try {
      const previous = await lookup(remembered);
      storage.setItem(key, previous.id);
      remembered = previous.id;
      if (previous.state !== "failed") return previous;
    } catch (cause) {
      if (!isGone(cause)) throw cause;
      storage.removeItem(key);
      remembered = null;
    }
  }
  const requestedId = remembered ?? crypto.randomUUID();
  storage.setItem(key, requestedId);
  const created = await create(requestedId);
  storage.setItem(key, created.id);
  return created;
}
