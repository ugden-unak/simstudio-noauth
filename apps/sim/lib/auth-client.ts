export const useSession = () => ({
  data: { user: { id: 'guest', name: 'Guest', email: 'guest@example.com' } },
  isPending: false,
})

export const useActiveOrganization = () => ({ data: null })

export const useSubscription = () => ({
  list: async () => ({ data: [] }),
  upgrade: async () => ({ data: null }),
  cancel: async () => ({ data: null }),
  restore: async () => ({ data: null }),
})

export const signIn = async () => ({})
export const signUp = async () => ({})
export const signOut = async () => ({})
