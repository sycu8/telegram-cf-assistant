import type { TelegramUpdate } from "./types";

export async function parseTelegramUpdate(request: Request): Promise<TelegramUpdate | null> {
  try {
    const update = (await request.json()) as Partial<TelegramUpdate>;
    if (typeof update.update_id !== "number") return null;
    return update as TelegramUpdate;
  } catch {
    return null;
  }
}
