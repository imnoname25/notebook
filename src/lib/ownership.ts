import { ApiError } from "@/lib/errors";

export function assertOwner(resourceUserId: string | undefined, currentUserId: string) {
  if (!resourceUserId || resourceUserId !== currentUserId) throw new ApiError(404, "Объект не найден");
}
