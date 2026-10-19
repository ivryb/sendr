import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { queries } from "@/lib/api"
import { authClient, deviceName, unwrap } from "@/lib/auth-client"

export function useAddPasskey({ onAdded }: { onAdded?: () => void } = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      unwrap(authClient.passkey.addPasskey({ name: deviceName() })),
    onSuccess: () => {
      toast.success("Passkey added. Use it next time you sign in.")
      queryClient.invalidateQueries({ queryKey: queries.passkeys.queryKey })
      onAdded?.()
    },
  })
}
