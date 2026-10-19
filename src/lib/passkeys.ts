import {
  queryOptions,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query"
import { toast } from "sonner"

import { authClient, deviceName, unwrap } from "@/lib/auth-client"

export const passkeysQuery = queryOptions({
  queryKey: ["passkeys"],
  queryFn: async () =>
    (await unwrap(authClient.passkey.listUserPasskeys())).data ?? [],
})

export function useAddPasskey({ onAdded }: { onAdded?: () => void } = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      unwrap(authClient.passkey.addPasskey({ name: deviceName() })),
    onSuccess: () => {
      toast.success("Passkey added. Use it next time you sign in.")
      queryClient.invalidateQueries({ queryKey: passkeysQuery.queryKey })
      onAdded?.()
    },
  })
}
