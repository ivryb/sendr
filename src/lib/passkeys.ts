import { toast } from "sonner"

import { authClient, deviceName, unwrap } from "@/lib/auth-client"
import { useChange } from "@/lib/mutations"

export function useAddPasskey({ onAdded }: { onAdded?: () => void } = {}) {
  return useChange({
    mutationFn: () =>
      unwrap(authClient.passkey.addPasskey({ name: deviceName() })),
    onSuccess: () => {
      toast.success("Passkey added. Use it next time you sign in.")
      onAdded?.()
    },
  })
}
